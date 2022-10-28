import { getInput, setFailed, setOutput } from "@actions/core";
import { context } from "@actions/github";
import * as utils from "./utils";
import * as INPUTS from "./constants/inputs";
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

    console.log("context.payload", context.payload);

    // Store Constant Values
    const ci_status = getInput(INPUTS.COMMENT_TEXT);
    const mentionUrl = "https://app.asana.com/0/";
    const repoName = context.payload.repository?.full_name;
    const pullRequestDescription =
      context.payload.pull_request?.body || context.payload.issue?.body;
    const pullRequestId =
      context.payload.pull_request?.number || context.payload.issue?.number;
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
    const prSynchronize =
      eventName === "pull_requestc" &&
      action === "synchronize"

    // Store User That Triggered Job
    const username =
      context.payload.comment?.user.login ||
      context.payload.review?.user.login ||
      context.payload.sender?.login;
    const userObj = users.find((user) => user.githubName === username);
    const userUrl = mentionUrl.concat(userObj?.asanaUrlId!);
    const userHTML = `<a href="${userUrl}">@${userObj?.asanaName}</a>`;

    // Store Otto
    const ottoObj = users.find((user) => user.githubName === "otto-bot-git");

    // Store Requested Reviewers
    const requestedReviewers =
      context.payload.pull_request?.requested_reviewers || [];

    let requestedReviewersObjs: any = [];
    for (const reviewer of requestedReviewers) {
      const reviewerObj = users.find(
        (user) => user.githubName === reviewer.login
      );
      requestedReviewersObjs.push(reviewerObj);
    }

    let QA_requestedReviewersObjs = requestedReviewersObjs.filter((reviewer: any) => reviewer.team === "QA");
    let DEV_requestedReviewersObjs = requestedReviewersObjs.filter((reviewer: any) => reviewer.team === "DEV");

    // Add User to Followers
    const followersStatus = [];
    const followers = [userObj?.asanaId];

    // Add Requested Reviewers to Followers
    for (const reviewer of !DEV_requestedReviewersObjs.length ? QA_requestedReviewersObjs : DEV_requestedReviewersObjs) {
      followers.push(reviewer?.asanaId);
    }

    // Get Images and Attach Them 
    
    // Get Arrows and Replace Them
    let commentBody =
      context.payload.comment?.body || context.payload.review?.body || "";
    const isReply = commentBody.charAt(0) === ">";

    /* <img
    data-gid=”12345”
    src=”https://s3.amazonaws.com/assets/123/Screenshot.png”
    alt=”\nhttps://s3.amazonaws.com/assets/123/Screenshot.png”
    style=”display:block;max-width: 100%; margin-left: auto;
    margin-right: auto;” >*/

    /* <img 
    width="883" 
    alt="image"
    src="https://user-images.githubusercontent.com/62925891/198328542-530a97e1-ff95-48fd-9c86-b30f19036705.png">*/

    const images = commentBody?.match(
      /\bhttps?:\/\/\S+/gi
    );
    console.log(images);
    

    // if (commentBody.includes(">") || commentBody.includes("<")){
    //   if (isReply){
    //     const lines = commentBody.split("\n");
    //     commentBody = lines.filter(function (
    //       line: string | string[]
    //     ) {
    //       return line.indexOf(">") !== 0;
    //     });
    //     commentBody.shift();
    //     commentBody = commentBody.join("")
    //   } else {
    //     commentBody = commentBody.replace(/>/g, "");
    //     commentBody = commentBody.replace(/</g, "");
    //   }
    // }

    console.log("commentBody", commentBody);
    

    // Get Mentioned Users In Comment
    const mentions = commentBody.match(/@\S+\w/gi) || []; // @user1 @user2
    for (const mention of mentions) {
      const mentionUserObj = users.find(
        (user) => user.githubName === mention.substring(1, mention.length)
      );
      // Add to Followers
      followers.push(mentionUserObj?.asanaId);
      // Add To Comment
      const mentionUserUrl = mentionUrl.concat(mentionUserObj?.asanaUrlId!);
      const mentionHTML = `<a href="${mentionUserUrl}">@${mentionUserObj?.asanaName}</a>`;
      commentBody = commentBody.replace(mention, mentionHTML);
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

    // Check if Automated CI Testing
    if (prSynchronize) {
      for (const id of asanaTasksIds!) {
        const approvalSubtask = await getApprovalSubtask(id, true, ottoObj, ottoObj);

        // If Found Update It, Else Create It
        if (approvalSubtask) {
          await asanaAxios.put(`${REQUESTS.TASKS_URL}${approvalSubtask.gid}`, {
            data: {
              approval_status: ci_status,
            },
          });
          continue;
        }

        addApprovalTask(asanaTasksIds, ottoObj, "Automate CI Testing", ci_status);
      }
      return;
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

    // Check if Review Requested OR PR Ready For Review
    if (prReviewRequested || prReadyForReview) {
      for (const reviewer of !DEV_requestedReviewersObjs.length ? QA_requestedReviewersObjs : DEV_requestedReviewersObjs) {
        for (const id of asanaTasksIds!) {
          const approvalSubtask = await getApprovalSubtask(id, false, reviewer, ottoObj);

          // If Request Reviewer already has incomplete subtask
          if (approvalSubtask) {
            continue;
          }

          addApprovalTask(asanaTasksIds, reviewer, "Review", "pending");
        }
      }
    }

    if (prReviewSubmitted) {
      for (const id of asanaTasksIds!) {
        const approvalSubtask = await getApprovalSubtask(id, false, userObj, ottoObj);

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
              subtask.resource_subtype === "approval" &&
              !subtask.completed &&
              subtask.created_by.gid === ottoObj?.asanaId
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
      const reviews = await githubAxios.get(githubUrl).then((response) => response.data);

      let is_approved_by_qa = true;
      let is_approved_by_dev = true;

      // Get All Users With Approved Review
      const usersApproved: String[] = [];
      for (let i = 0; i < reviews.length; i++) {
        const review = reviews[i];
        if (review.state === "APPROVED") {
          usersApproved.push(review.user.login);
        }
      }

      // Check if QA/DEV Reviewers Approved
      requestedReviewersObjs.forEach((reviewer: any) => {
        const username = reviewer.githubName;
        const team = reviewer.team;
        if (!usersApproved.includes(username)) {
          team === "DEV" ? is_approved_by_dev = false : is_approved_by_qa = false;
        }
      });

      // Check If Should Create QA Tasks
      if (is_approved_by_dev && !is_approved_by_qa) {
        QA_requestedReviewersObjs.forEach(async (reviewer: any) => {
          followers.push(reviewer?.asanaId);
          for (const id of asanaTasksIds!) {
            const approvalSubtask = await getApprovalSubtask(id, false, reviewer, ottoObj);

            // If Request Reviewer already has incomplete subtask
            if (approvalSubtask) {
              continue;
            }

            addApprovalTask(asanaTasksIds, reviewer, "Review", "pending");
          }
        });
      }

      // Check If Should Move To Approved
      if (is_approved_by_dev && is_approved_by_qa) {
        moveToApprovedSection(asanaTasksIds);
      }
    }

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

    // Get Correct Dynamic Comment
    let commentText = "";
    switch (eventName) {
      case "issue_comment": {
        if (isReply) {
          commentText = `<body> ${userHTML} <a href="${commentUrl}">replied</a>:\n\n${commentBody} </body>`;
        } else {
          commentText =
            username === "otto-bot-git"
              ? `<body> ${commentBody}\n<a href="${commentUrl}">Comment URL</a> </body>`
              : `<body> ${userHTML} <a href="${commentUrl}">commented</a>:\n\n${commentBody} </body>`;
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
            commentText = `<body> ${userHTML} is requesting the following <a href="${commentUrl}">changes</a>:\n\n${commentBody} </body>`;
            break;
          case "approved":
            if (!context.payload.review.body) {
              return;
            }
            commentText = `<body> ${userHTML} approved with the following <a href="${commentUrl}">comment</a>:\n\n${context.payload.review.body} </body>`;
            break;
          default:
            commentText = `<body> <a href="${commentUrl}">PR #${pullRequestId}</a> is ${reviewState} by ${userHTML} </body>`;
            break;
        }
        break;
      case "pull_request":
        if (
          action === "review_requested" ||
          action === "ready_for_review" ||
          action === "edited"
        ) {
          return;
        } else if (action === "closed" && pullRequestMerged) {
          commentText = `<body> <a href="${pullRequestURL}">PR #${pullRequestId}</a> is merged and ${pullRequestState}. </body>`;
        } else {
          commentText = `<body> <a href="${pullRequestURL}">PR #${pullRequestId}</a> is ${pullRequestState}. </body>`;
        }
        break;
      case "pull_request_review_comment": {
        const path = context.payload.comment?.path;
        const files = path.split("/");
        const fileName = files[files.length - 1];

        commentText = `<body> ${userHTML} is requesting the following <a href="${commentUrl}">changes</a> on ${fileName} (Line ${context.payload.comment?.original_line}):\n\n${commentBody} </body>`;
        if (context.payload.comment?.in_reply_to_id) {
          commentText = `<body> ${userHTML} <a href="${commentUrl}">replied</a> on ${fileName} (Line ${context.payload.comment?.original_line}):\n\n${commentBody} </body>`;
        }
        break;
      }
    }

    // Post Comment to Asana
    let commentResult: any = "";
    for (const id of asanaTasksIds!) {
      const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.STORIES_URL}`;
      if (action === "edited") {
        let comments = await asanaAxios.get(url);
        const comment = comments.data.data.find(
          (comment: any) =>
            comment.resource_subtype === "comment_added" &&
            comment.created_by.gid === ottoObj?.asanaId &&
            comment.text.includes(commentUrl)
        );
        commentResult = await asanaAxios.put(`${REQUESTS.STORIES_URL}${comment.gid}`, {
          data: {
            html_text: commentText,
          },
        });
      }
      else {
        commentResult = await asanaAxios.post(url, {
          data: {
            html_text: commentText,
          },
        });
      }
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
  asanaTasksIds: Array<String>
) => {
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
  asanaTaskId: Array<String>,
  requestedReviewer: any,
  taskName: String,
  approvalStatus: String,
) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Create Approval Subtasks For Requested Reviewer
  await asanaAxios.post(`${REQUESTS.TASKS_URL}${asanaTaskId}${REQUESTS.SUBTASKS_URL}`, {
    data: {
      assignee: requestedReviewer?.asanaId,
      approval_status: approvalStatus,
      completed: false,
      due_on: tomorrow.toISOString().substring(0, 10),
      resource_subtype: "approval",
      name: taskName,
    },
  });
};

export const getApprovalSubtask = async (
  asanaTaskId: String,
  is_complete: boolean,
  assignee: any,
  creator: any
) => {
  const url = `${REQUESTS.TASKS_URL}${asanaTaskId}${REQUESTS.SUBTASKS_URL}`;
  const subtasks = await asanaAxios.get(url);
  const approvalSubtask = subtasks.data.data.find(
    (subtask: any) =>
      subtask.resource_subtype === "approval" &&
      subtask.completed === is_complete &&
      subtask.assignee.gid === assignee?.asanaId &&
      subtask.created_by.gid === creator?.asanaId
  );

  return approvalSubtask;
};

run();


