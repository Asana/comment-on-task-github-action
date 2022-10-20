import { /*getInput,*/ setFailed, setOutput } from "@actions/core";
import { context } from "@actions/github";
import * as utils from "./utils";
import * as INPUTS from "./constants/inputs";
import axios from "./requests/axios";
import asanaAxios from "./requests/asanaAxios";
import * as REQUESTS from "./constants/requests";
import { users } from "./constants/users";
import githubAxios from "./requests/githubAxios";

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
    const repoName = context.payload.repository?.full_name;
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

    // Store Conditions
    const prClosedMerged =
      eventName === "pull_request" &&
      action === "closed" &&
      context.payload.pull_request?.merged;
    const prReviewChangesRequested =
      eventName === "pull_request_review" &&
      reviewState === "changes_requested";
    const prReviewRequested =
      eventName === "pull_request" &&
      !context.payload.pull_request?.draft &&
      action === "review_requested";
    const prReadyForReview =
      eventName === "pull_request" &&
      (action === "ready_for_review" ||
        ((action === "opened" || action === "edited") &&
          !context.payload.pull_request?.draft));
    const prReviewSubmitted =
      eventName === "pull_request_review" && action === "submitted";
    const prApproved =
      eventName === "pull_request_review" &&
      action === "submitted" &&
      reviewState === "approved";

    // Store User That Triggered Job
    const username =
      context.payload.comment?.user.login ||
      context.payload.review?.user.login ||
      context.payload.sender?.login;
    const userObj = users.find((user) => user.githubName === username);
    const userUrl = mentionUrl.concat(userObj?.asanaUrlId!);

    // Store Requested Reviewers
    const requestedReviewerName =
      context.payload.requested_reviewer?.login || "";
    const requestedReviewerObj = users.find(
      (user) => user.githubName === requestedReviewerName
    );
    const requestedReviewers =
      requestedReviewerObj ||
      context.payload.pull_request?.requested_reviewers ||
      [];

    // Add User to Followers
    const followersStatus = [];
    const followers = [userObj?.asanaId];

    // Add Requested Reviewers to Followers
    if (Array.isArray(requestedReviewers)) {
      for (const reviewer of requestedReviewers) {
        const reviewerObj = users.find(
          (user) => user.githubName === reviewer.login
        );
        followers.push(reviewerObj?.asanaId);
      }
    } else {
      followers.push(requestedReviewers.asanaId);
    }

    // Get Mentioned Users In Comment
    let commentBody =
      context.payload.comment?.body || context.payload.review?.body || "";
    const mentions = commentBody.match(/@\S+\w/gi) || []; // @user1 @user2
    for (const mention of mentions) {
      const mentionUserObj = users.find(
        (user) => user.githubName === mention.substring(1, mention.length)
      );
      // Add to Followers
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

    // Check if PR Ready For Review
    if (prReviewRequested || prReadyForReview) {
      if (Array.isArray(requestedReviewers)) {
        for (const reviewer of requestedReviewers) {
          const reviewerObj = users.find(
            (user) => user.githubName === reviewer.login
          );
          addApprovalTask(asanaTasksIds, reviewerObj);
        }
      } else {
        addApprovalTask(asanaTasksIds, requestedReviewers);
      }
    }

    if (prReviewSubmitted) {
      for (const id of asanaTasksIds!) {
        // Get Approval Subtasks
        const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.SUBTASKS_URL}`;
        const subtasks = await asanaAxios.get(url);
        const approvalSubtask = subtasks.data.data.find(
          (subtask: any) =>
            subtask.resource_subtype === "approval" &&
            !subtask.completed &&
            subtask.assignee.gid === userObj?.asanaId
        );

        // Update Approval Subtask Of User
        if (approvalSubtask) {
          await asanaAxios.put(`${REQUESTS.TASKS_URL}${approvalSubtask.gid}`, {
            data: {
              approval_status: reviewState,
            },
          });
        }
      }
    }

    // Check If PR Closed/Merged OR Changes Requested
    let approvalSubtasks: any = [];
    if (prClosedMerged || prReviewChangesRequested) {
      setTimeout(async () => {
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
      }, 60000);
    }

    // Check if PR Review Approved
    if (prApproved) {
      // Retrieve All Reviews of PR
      const githubUrl = `${REQUESTS.REPOS_URL}${repoName}${REQUESTS.PULLS_URL}${pullRequestId}${REQUESTS.REVIEWS_URL}`;
      const reviews = await githubAxios.get(githubUrl);

      // Check If All Approved and Move Accordingly
      moveToApprovedSection(asanaTasksIds, reviews.data);
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
            if (!context.payload.review.body) {
              return;
            }
            commentText = `${userUrl} approved:\n\n${context.payload.review.body}\n\nComment URL -> ${commentUrl}`;
            break;
          default:
            commentText = `PR #${pullRequestId} ${pullRequestName} is ${reviewState} by ${userUrl} -> ${commentUrl}`;
            break;
        }
        break;
      case "pull_request":
        if (
          action === "review_requested" ||
          action === "opened" ||
          action === "ready_for_review" ||
          action === "edited"
        ) {
          return;
        } else {
          commentText = `<a href=${pullRequestURL}>PR #${pullRequestId}</a> is ${pullRequestState}.`;
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

    // Post Comment to Asana
    let commentResult:any = "";
    if (eventName === "pull_request") {
      for (const id of asanaTasksIds!) {
        const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.STORIES_URL}`;
        await asanaAxios.post(url, {
          data: {
            html_text: commentText,
          },
        });
      }
    } else {
      commentResult = await axios.post(REQUESTS.ACTION_URL, {
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
    }

    setOutput(`event`, eventName);
    setOutput(`action`, action);

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

export const moveToApprovedSection = async (
  asanaTasksIds: Array<String>,
  reviews: Array<any>
) => {
  // Check If All Reviews Approved
  for (const review of reviews) {
    if (review.state !== "approved") {
      return;
    }
  }

  // Move Asana Task To Approved Section
  for (const task of asanaTasksIds!) {
    const url = `${REQUESTS.SECTIONS_URL}1202529262059895${REQUESTS.ADD_TASK_URL}`;
    await asanaAxios.post(url, {
      data: {
        task,
      },
    });
  }
};

export const addApprovalTask = async (
  asanaTasksIds: Array<String>,
  requestedReviewer: any
) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  for (const id of asanaTasksIds!) {
    // Get Approval Subtasks
    const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.SUBTASKS_URL}`;
    const subtasks = await asanaAxios.get(url);
    const approvalSubtask = subtasks.data.data.find(
      (subtask: any) =>
        subtask.resource_subtype === "approval" &&
        !subtask.completed &&
        subtask.assignee.gid === requestedReviewer?.asanaId
    );

    // If Request Reviewer already has incomplete subtask
    if (approvalSubtask) {
      continue;
    }

    // Create Approval Subtasks For Requested Reviewer
    await asanaAxios.post(url, {
      data: {
        assignee: requestedReviewer?.asanaId,
        approval_status: "pending",
        completed: false,
        due_on: tomorrow.toISOString().substring(0, 10),
        resource_subtype: "approval",
        name: "Review",
      },
    });
  }
};
run();
