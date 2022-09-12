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
    if (context.eventName === "pull_request_review"){
      const dynamicCommentText =`${context.payload.review?.user.login} commented:\n\n${context.payload.review?.body}\n\nComment URL -> ${context.payload.review?.html_url}`;

      const result = await axios.post(REQUESTS.ACTION_URL, {
        allowedProjects,
        blockedProjects,
        commentText: dynamicCommentText,
        pullRequestDescription: context.payload.review?.body,
        pullRequestId: context.payload.review?.number,
        pullRequestName: context.payload.review?.title,
        pullRequestURL: context.payload.review?.html_url,
        pullRequestState: context.payload.review?.state,
        pullRequestMerged: false,
      });

      setOutput("status", result.status);
    } else if (context.eventName === "issue_comment") {
      /*Construct The Comment as: 
        User commented:
        hello world!
        Comment URL -> git.com */

      const dynamicCommentText =
        context.payload.comment?.user.login === "github-actions"
          ? `${context.payload.comment?.user.login} commented -> ${context.payload.comment?.html_url}`
          : `${context.payload.comment?.user.login} commented:\n\n${context.payload.comment?.body}\n\nComment URL -> ${context.payload.comment?.html_url}`;

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
      console.log(context);
      const dynamicCommentText =
        context.payload.action === "review_requested"
          ? `PR #${context.payload.pull_request?.number} ${context.payload.pull_request?.title} is requesting a review from ${context.payload.requested_reviewer?.login} -> ${context.payload.pull_request?.html_url}`
          : commentText;

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
