import { getInput, setFailed, setOutput } from "@actions/core";
import { context } from "@actions/github";
import * as utils from "./utils";
import axios from "./requests/axios";
import * as INPUTS from "./constants/inputs";
import * as REQUESTS from "./constants/requests";

const commentText = getInput(INPUTS.COMMENT_TEXT);
const allowedProjects = utils.getProjectsFromInput(INPUTS.ALLOWED_PROJECTS);
const blockedProjects = utils.getProjectsFromInput(INPUTS.BLOCKED_PROJECTS);

export const run = async () => {
  try {
    utils.validateTrigger(context.eventName);
    utils.validateProjectLists(allowedProjects, blockedProjects);

    // Check If It's a Pull Request Comment
    if (context.eventName === "issue_comment") {
      /*Construct The Comment as: 
        User commented:
        hello world!
        Comment URL -> git.com */
      const user = context.payload.comment?.user.login;
      const commentUrl = context.payload.comment?.html_url;

      let commentBody = context.payload.comment?.body;
      let dynamicCommentText = "";

      if (commentBody.includes(">")) {
        const lines = commentBody.split("\n");
        const commentBodyLines = lines.filter(function (
          line: string | string[]
        ) {
          return line.indexOf(">") !== 0;
        });
        commentBodyLines.shift();
        commentBody = commentBodyLines.join("");
        dynamicCommentText = `${user} replied:\n\n${commentBody}\n\nComment URL -> ${commentUrl}`;
      } else {
        dynamicCommentText =
          user === "github-actions"
            ? `${user} commented -> ${commentUrl}`
            : `${user} commented:\n\n${commentBody}\n\nComment URL -> ${commentUrl}`;
      }

      const result = await axios.post(REQUESTS.ACTION_URL, {
        allowedProjects,
        blockedProjects,
        commentText: dynamicCommentText,
        pullRequestDescription: context.payload.issue?.body,
        pullRequestId: context.payload.issue?.number,
        pullRequestName: context.payload.issue?.title,
        pullRequestURL: context.payload.issue?.html_url,
        pullRequestState: context.payload.issue?.state,
        pullRequestMerged: false,
      });
      setOutput("status", result.status);
    } else {
      /*Check If It's a Pull Request With Review Requested Status
        If So, Construct The Comment as: 
        PR #50 Title is requesting a review from User1 -> git.com */

      let dynamicCommentText = commentText;
      if (context.eventName === "pull_request_review") {
        dynamicCommentText =
          context.payload.review?.state === "CHANGES_REQUESTED"
            ? `${context.payload.review?.user.login} is requesting the following changes:\n\n${context.payload.review?.body}\n\nComment URL -> ${context.payload.review?.html_url}`
            : `PR #${context.payload.pull_request?.number} ${context.payload.pull_request?.title} is ${context.payload.review?.state} by ${context.payload.review?.user.login} -> ${context.payload.review?.html_url}`;
      } else if (context.payload.action === "review_requested") {
        dynamicCommentText = `PR #${context.payload.pull_request?.number} ${context.payload.pull_request?.title} is requesting a review from ${context.payload.requested_reviewer?.login} -> ${context.payload.pull_request?.html_url}`;
      }

      const result = await axios.post(REQUESTS.ACTION_URL, {
        allowedProjects,
        blockedProjects,
        commentText: dynamicCommentText,
        pullRequestDescription: context.payload.pull_request?.body,
        pullRequestId: context.payload.pull_request?.number,
        pullRequestName: context.payload.pull_request?.title,
        pullRequestURL: context.payload.pull_request?.html_url,
        pullRequestState: context.payload.pull_request?.state,
        pullRequestMerged: context.payload.pull_request?.merged || false,
      });
      setOutput("status", result.status);
    }
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
