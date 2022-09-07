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
      const dynamicCommentText = `${context.payload.comment?.user.login} commented:\n\n${context.payload.comment?.body}\n\nComment URL -> ${context.payload.comment?.html_url}`;

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
        Construct The Comment as: 
        PR #50 Title is requesting a review from User1, User2, User3 -> git.com */
      const dynamicCommentText = `PR #${context.payload.pull_request?.number} ${context.payload.pull_request?.title} is ${context.payload.pull_request?.state} and awaiting a review from ${context.payload.pull_request?.requested_reviewer.login} -> ${context.payload.pull_request?.html_url}`;

      const result = await axios.post(REQUESTS.ACTION_URL, {
        allowedProjects,
        blockedProjects,
        commentText:
          context.payload.action === "review_requested"
            ? dynamicCommentText
            : commentText,
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
