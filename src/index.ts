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
    utils.validateTrigger(context.eventName);
    utils.validateProjectLists(allowedProjects, blockedProjects);

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
    const userUrl = mentionUrl.concat(userObj?.asanaId!);

    // Store Requested Reviewer User
    const requestedReviewerName =
      context.payload.requested_reviewer?.login || "";
    const requestedReviewerObj = users.find(
      (user) => user.githubName === requestedReviewerName
    );
    const requestedReviewerUrl = mentionUrl.concat(
      requestedReviewerObj?.asanaId!
    );

    // Add Users to Followers
    const followersStatus = [];
    const followers = [userObj?.asanaId];
    if (requestedReviewerObj) {
      followers.push(requestedReviewerObj.asanaId);
    }

    // Get Mentioned Users In Comment
    const commentBody =
      context.payload.comment?.body || context.payload.review?.body || "";
    const mentions = commentBody.match(/@\S+/gi); // @user1 @user2
    for (const mention of mentions) {
      // Add to Followers
      const mentionUserObj = users.find(
        (user) => user.githubName === mention.substring(1, mention.length)
      );
      followers.push(mentionUserObj?.asanaId);
      // Add To Comment
      const mentionUserUrl = mentionUrl.concat(mentionUserObj?.asanaId!);
      commentBody.replace(mention, mentionUserUrl);
    }

    // Get Task IDs From PR Description
    const asanaTasksLinks = pullRequestDescription?.match(
      /\bhttps?:\/\/\b(app\.asana\.com)\b\S+/gi
    );
    const asanaTasksIds = asanaTasksLinks?.map((link) => {
      const linkArray = link.split("/");
      if (isNaN(Number(linkArray[linkArray.length - 1]))) {
        // Check If Link is Attached From Github or Asana
        return linkArray[linkArray.length - 2];
      }
      return linkArray[linkArray.length - 1];
    });

    // Call Asana Axios To Add Followers To the Tasks
    for (const id of asanaTasksIds!) {
      const url = `${id}${REQUESTS.FOLLOWER_URL}`;
      const followersResult = await asanaAxios.post(url, {
        data: {
          followers,
        },
      });
      followersStatus.push({ taskId: id, status: followersResult.status });
    }

    // Get Correct Dynamic Comment
    let commentText = "";
    switch (context.eventName) {
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
            username === "github-actions"
              ? `${username} commented -> ${commentUrl}`
              : `${userUrl} commented:\n\n${commentBody}\n\nComment URL -> ${commentUrl}`;
        }
        break;
      }
      case "pull_request_review":
        switch (reviewState) {
          case "commented":
          case "changes_requested":
            if (!commentBody) {
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
        if (context.payload.action === "review_requested") {
          commentText = `${userUrl} is requesting a review from ${requestedReviewerUrl} on PR #${pullRequestId} -> ${pullRequestURL}`;
        } else {
          commentText = getInput(INPUTS.COMMENT_TEXT);
        }
        break;
      case "pull_request_review_comment":
        commentText = `${userUrl} is requesting the following changes on line ${context.payload.comment?.original_line}:\n\n${commentBody}\n\nComment URL -> ${commentUrl}`;
        break;
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
