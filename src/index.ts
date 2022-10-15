import { getInput, setFailed, setOutput } from "@actions/core";
import { context } from "@actions/github";
import * as utils from "./utils";
import * as INPUTS from "./constants/inputs";
import axios from "./requests/axios";
import asanaAxios from "./requests/asanaAxios";
import * as REQUESTS from "./constants/requests";
import { users } from "./constants/users";

const allowedProjects = utils.getProjectsFromInput(INPUTS.ALLOWED_PROJECTS);
const blockedProjects = utils.getProjectsFromInput(INPUTS.BLOCKED_PROJECTS);

export const run = async () => {
  try {
    // Validate Inputs
    const eventName = context.eventName;
    const action = context.payload.action;
    utils.validateTrigger(eventName);
    utils.validateProjectLists(allowedProjects, blockedProjects);

    console.log("context.eventName", eventName);
    console.log("context.payload.action", action);
    console.log("context.payload", context.payload);

    // Store Constant Values
    const mentionUrl = "https://app.asana.com/0/";
    const pullRequestDescription =
      context.payload.pull_request?.body || context.payload.issue?.body;
    const pullRequestId =
      context.payload.pull_request?.number || context.payload.issue?.number;
    const pullRequestName =
      context.payload.pull_request?.title || context.payload.issue?.title;
    const pullRequestURL =
      context.payload.pull_request?.html_url || context.payload.issue?.html_url;
    const pullRequestState =
      context.payload.pull_request?.state || context.payload.issue?.state;
    const pullRequestMerged = context.payload.pull_request?.merged || false;
    const reviewState = context.payload.review?.state || "";
    const commentUrl =
      context.payload.comment?.html_url ||
      context.payload.review?.html_url ||
      "";

    // Store User That Triggered Job
    const username =
      context.payload.comment?.user.login ||
      context.payload.review?.user.login ||
      context.payload.sender?.login;
    const userObj = users.find((user) => user.githubName === username);
    const userUrl = mentionUrl.concat(userObj?.asanaUrlId!);

    // Store Requested Reviewer User
    const requestedReviewerName =
      context.payload.requested_reviewer?.login || "";
    const requestedReviewerObj = users.find(
      (user) => user.githubName === requestedReviewerName
    );

    // Add Users to Followers
    const followersStatus = [];
    const followers = [userObj?.asanaId];
    if (requestedReviewerObj) {
      followers.push(requestedReviewerObj.asanaId);
    }

    // Get Mentioned Users In Comment
    let commentBody =
      context.payload.comment?.body || context.payload.review?.body || "";
    const mentions = commentBody.match(/@\S+/gi) || []; // @user1 @user2
    for (const mention of mentions) {
      // Add to Followers
      const mentionUserObj = users.find(
        (user) => user.githubName === mention.substring(1, mention.length)
      );
      followers.push(mentionUserObj?.asanaId);
      // Add To Comment
      const mentionUserUrl = mentionUrl.concat(mentionUserObj?.asanaUrlId!);
      commentBody = commentBody.replace(mention, mentionUserUrl);
    }

    // Get Task IDs From PR Description
    const asanaTasksLinks = pullRequestDescription?.match(
      /\bhttps?:\/\/\b(app\.asana\.com)\b\S+/gi
    );
    const asanaTasksIds =
      asanaTasksLinks?.map((link) => {
        const linkArray = link.split("/");
        if (isNaN(Number(linkArray[linkArray.length - 1]))) {
          // Check If Link is Attached From Github or Asana
          return linkArray[linkArray.length - 2];
        }
        return linkArray[linkArray.length - 1];
      }) || [];

    // Call Asana Axios To Add Followers To the Tasks
    for (const id of asanaTasksIds!) {
      const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.ADD_FOLLOWERS_URL}`;
      const followersResult = await asanaAxios.post(url, {
        data: {
          followers,
        },
      });
      followersStatus.push({ taskId: id, status: followersResult.status });
    }

    // Check if PR has Merge Conflicts
    const prMergeConflicts =
      eventName === "issue_comment" &&
      username === "otto-bot-git" &&
      !commentBody.includes("Conflicts have been resolved");
    if (prMergeConflicts) {
      // Move Asana Task To Next Section
      for (const task of asanaTasksIds!) {
        const url = `${REQUESTS.SECTIONS_URL}351348922863102${REQUESTS.ADD_TASK_URL}`;
        await asanaAxios.post(url, {
          data: {
            task,
          },
        });
      }
    }

    // Check if Requesting Review
    const prReviewRequested =
      eventName === "pull_request" &&
      !context.payload.pull_request?.draft &&
      action === "review_requested";
    const prReadyForReview =
      eventName === "pull_request" &&
      (action === "ready_for_review" || action === "opened");
    const requestedReviewers =
      context.payload.pull_request?.requested_reviewers || [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (prReadyForReview) {
      for (const reviewer of requestedReviewers) {
        const reviewerObj = users.find(
          (user) => user.githubName === reviewer.login
        );
        for (const id of asanaTasksIds!) {
          // Get Approval Subtasks
          const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.SUBTASKS_URL}`;
          const subtasks = await asanaAxios.get(url);
          const approvalSubtask = subtasks.data.data.find(
            (subtask: any) =>
              subtask.resource_subtype === "approval" &&
              !subtask.completed &&
              subtask.assignee.gid === reviewerObj?.asanaId
          );

          // If Request Reviewer already has incomplete subtask
          if (approvalSubtask) {
            continue;
          }

          // Create Approval Subtasks For Requested Reviewer
          await asanaAxios.post(url, {
            data: {
              assignee: reviewerObj?.asanaId,
              approval_status: "pending",
              completed: false,
              due_on: tomorrow.toISOString().substring(0, 10),
              resource_subtype: "approval",
              name: "Review",
            },
          });
        }
      }
    }

    if (prReviewRequested) {
      for (const id of asanaTasksIds!) {
        // Get Approval Subtasks
        const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.SUBTASKS_URL}`;
        const subtasks = await asanaAxios.get(url);
        const approvalSubtask = subtasks.data.data.find(
          (subtask: any) =>
            subtask.resource_subtype === "approval" &&
            !subtask.completed &&
            subtask.assignee.gid === requestedReviewerObj?.asanaId
        );

        // If Request Reviewer already has incomplete subtask
        if (approvalSubtask) {
          continue;
        }

        // Create Approval Subtasks For Requested Reviewer
        await asanaAxios.post(url, {
          data: {
            assignee: requestedReviewerObj?.asanaId,
            approval_status: "pending",
            completed: false,
            due_on: tomorrow.toISOString().substring(0, 10),
            resource_subtype: "approval",
            name: "Review",
          },
        });
      }
    }

    // Check If PR Closed and Merged
    let approvalSubtasks: any = [];
    const prClosedMerged =
      eventName === "pull_request" &&
      action === "closed" &&
      context.payload.pull_request?.merged;
    const prReviewChangesRequested =
      eventName === "pull_request_review" &&
      reviewState === "changes_requested";

    if (prClosedMerged || prReviewChangesRequested) {
      // Get Approval Subtasks
      for (const id of asanaTasksIds!) {
        const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.SUBTASKS_URL}`;
        const subtasks = await asanaAxios.get(url);
        approvalSubtasks = subtasks.data.data.filter(
          (subtask: any) =>
            subtask.resource_subtype === "approval" && !subtask.completed
        );
      }

      // Delete Incomplete Approval Taks
      for (const subtask of approvalSubtasks) {
        await asanaAxios.delete(`${REQUESTS.TASKS_URL}${subtask.gid}`);
      }
    }

    // Get Correct Dynamic Comment
    let commentText = "";
    switch (eventName) {
      case "issue_comment": {
        if (commentBody.includes(">")) {
          const lines = commentBody.split("\n");
          const commentBodyLines = lines.filter(function (
            line: string | string[]
          ) {
            return line.indexOf(">") !== 0;
          });
          commentBodyLines.shift();
          commentText = `${userUrl} replied:\n\n${commentBodyLines.join(
            ""
          )}\n\nComment URL -> ${commentUrl}`;
        } else {
          commentText =
            username === "otto-bot-git"
              ? `${commentBody}\n\nComment URL -> ${commentUrl}`
              : `${userUrl} commented:\n\n${commentBody}\n\nComment URL -> ${commentUrl}`;
        }
        break;
      }
      case "pull_request_review":
        switch (reviewState) {
          case "commented":
          case "changes_requested":
            if (!commentBody || action === "edited") {
              return;
            }
            commentText = `${userUrl} is requesting the following changes:\n\n${commentBody}\n\nComment URL -> ${commentUrl}`;
            break;
          case "approved":
            commentText = `PR #${pullRequestId} ${pullRequestName} is approved by ${userUrl} ${
              commentBody.length === 0
                ? ``
                : `:\n\n ${commentBody}\n\nComment URL`
            } -> ${commentUrl}`;
            break;
          default:
            commentText = `PR #${pullRequestId} ${pullRequestName} is ${reviewState} by ${userUrl} -> ${commentUrl}`;
            break;
        }
        break;
      case "pull_request":
        if (action === "review_requested" || action === "opened" || action === "ready_for_review") {
          return;
        } else {
          commentText = getInput(INPUTS.COMMENT_TEXT);
        }
        break;
      case "pull_request_review_comment": {
        const path = context.payload.comment?.path;
        const files = path.split("/");
        const fileName = files[files.length - 1];
        commentText = `${userUrl} is requesting the following changes on ${fileName} (Line ${context.payload.comment?.original_line}):\n\n${commentBody}\n\nComment URL -> ${commentUrl}`;
        break;
      }
    }

    // Post Comment To Asana
    const commentResult = await axios.post(REQUESTS.ACTION_URL, {
      allowedProjects,
      blockedProjects,
      commentText,
      pullRequestDescription,
      pullRequestId,
      pullRequestName,
      pullRequestURL,
      pullRequestState,
      pullRequestMerged,
    });

    setOutput(`followersStatus`, followersStatus);
    setOutput("commentStatus", commentResult.status);
    setOutput("comment", commentText);
  } catch (error) {
    if (utils.isAxiosError(error)) {
      console.log(error.response);
      console.log(error.response?.data || "Unknown error");
    }
    if (error instanceof Error) setFailed(error.message);
    else setFailed("Unknown error");
  }
};

run();
