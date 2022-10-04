import { getInput, setFailed, setOutput } from "@actions/core";
import { context } from "@actions/github";
import * as utils from "./utils";
import * as INPUTS from "./constants/inputs";
import axios from "./requests/axios";
import * as REQUESTS from "./constants/requests";

const allowedProjects = utils.getProjectsFromInput(INPUTS.ALLOWED_PROJECTS);
const blockedProjects = utils.getProjectsFromInput(INPUTS.BLOCKED_PROJECTS);

export const run = async () => {
  try {
    utils.validateTrigger(context.eventName);
    utils.validateProjectLists(allowedProjects, blockedProjects);
    let commentText = "";
    let user = "";
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

    switch (context.eventName) {
      case "issue_comment": {
        user = context.payload.comment?.user.login;
        const commentUrl = context.payload.comment?.html_url;
        let commentBody = context.payload.comment?.body;

        if (commentBody.includes(">")) {
          const lines = commentBody.split("\n");
          const commentBodyLines = lines.filter(function (
            line: string | string[]
          ) {
            return line.indexOf(">") !== 0;
          });
          commentBodyLines.shift();
          commentBody = commentBodyLines.join("");
          commentText = `${user} replied:\n\n${commentBody}\n\nComment URL -> ${commentUrl}`;
        } else {
          commentText =
            user === "github-actions"
              ? `${user} commented -> ${commentUrl}`
              : `${user} commented:\n\n${commentBody}\n\nComment URL -> ${commentUrl}`;
        }
        break;
      }
      case "pull_request_review": {
        user = context.payload.review?.user.login;
        const state = context.payload.review?.state;
        const reviewBody = context.payload.review?.body;
        const reviewUrl = context.payload.review?.html_url;
        switch (state) {
          case "commented":
          case "changes_requested":
            if (!reviewBody) {
              return;
            }
            commentText = `${user} is requesting the following changes:\n\n${reviewBody}\n\nComment URL -> ${reviewUrl}`;
            break;
          case "approved":
            commentText = `PR #${pullRequestId} ${pullRequestName} is approved by ${user} ${
              reviewBody.length === 0
                ? ``
                : `:\n\n ${reviewBody}\n\nComment URL`
            } -> ${reviewUrl}`;
            break;
          default:
            commentText = `PR #${pullRequestId} ${pullRequestName} is ${state} by ${user} -> ${reviewUrl}`;
            break;
        }
        break;
      }
      case "pull_request": {
        if (context.payload.action === "review_requested") {
          commentText = `${context.payload.sender?.login} is requesting a review from ${context.payload.requested_reviewer?.login} on PR #${pullRequestId} -> ${pullRequestURL}`;
        } else {
          commentText = getInput(INPUTS.COMMENT_TEXT);
        }
        break;
      }
      case "pull_request_review_comment":{
        commentText = `${context.payload.comment?.user.login} is requesting the following changes on line ${context.payload.comment?.original_line}:\n\n${context.payload.comment?.body}\n\nComment URL -> ${context.payload.comment?.html_url}`;
        break;
      }
    }

    const result = await axios.post(REQUESTS.ACTION_URL, {
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
    setOutput("status", result.status);
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
