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

    console.log(context.eventName);
    if (context.eventName === "issue_comment") {
      console.log("ISSUE_COMMENT");
      const result = await axios.post(REQUESTS.ACTION_URL, {
        allowedProjects,
        blockedProjects,
        commentText,
        issueId: context.payload.issue?.number,
        issueName: context.payload.issue?.title,
        issueUrl: context.payload.issue?.html_url,
        issueState: context.payload.issue?.state,
        commentOwner: context.payload.sender?.login,
        commentBody: context.payload.comment?.body,
      });
      console.log(result);
      setOutput("data", result.config.data);
      setOutput("status", result.status);
    } else {
      const result = await axios.post(REQUESTS.ACTION_URL, {
        allowedProjects,
        blockedProjects,
        commentText,
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
      console.log(error.response?.data || "Unknown error");
    }
    if (error instanceof Error) setFailed(error.message);
    else setFailed("Unknown error");
  }
};

run();
