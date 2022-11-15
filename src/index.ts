import { getInput, setFailed, setOutput } from "@actions/core";
import { context } from "@actions/github";
import * as utils from "./utils";
import * as INPUTS from "./constants/inputs";
import asanaAxios from "./requests/asanaAxios";
import * as REQUESTS from "./constants/requests";
import * as SECTIONS from "./constants/sections";
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
    const action_url = getInput(INPUTS.ACTION_URL);
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
      eventName === "pull_request" &&
      action === "synchronize";
    const prPush =
      eventName === "push";

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

    let QA_requestedReviewersObjs = requestedReviewersObjs.filter((reviewer: any) => reviewer.team === "QA") || [];
    let DEV_requestedReviewersObjs = requestedReviewersObjs.filter((reviewer: any) => reviewer.team === "DEV") || [];

    // Add User to Followers
    const followersStatus = [];
    const followers = [userObj?.asanaId];

    // Add Requested Reviewers to Followers
    for (const reviewer of !DEV_requestedReviewersObjs.length ? QA_requestedReviewersObjs : DEV_requestedReviewersObjs) {
      followers.push(reviewer?.asanaId);
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
    if (prSynchronize || prPush) {
      const html_action_url = `<body> <a href='${action_url}'> Click Here To Investigate Action </a> </body>`
      for (const id of asanaTasksIds!) {
        const approvalSubtask = await getApprovalSubtask(id, true, ottoObj, ottoObj);

        // Check If Subtask Found
        if (approvalSubtask) {

          // Check If Subtask rejected -> approved
          if (approvalSubtask.approval_status === "rejected" && ci_status === "approved") {
            for (const reviewer of !DEV_requestedReviewersObjs.length ? QA_requestedReviewersObjs : DEV_requestedReviewersObjs) {
              addRequestedReview(id, reviewer, ottoObj);
            }
          }

          // Check if Subtask approved -> rejected
          if (approvalSubtask.approval_status === "approved" && ci_status === "rejected") {
            const approvalSubtasks = await getAllApprovalSubtasks(id, ottoObj);
            deleteApprovalTasks(approvalSubtasks);
            moveTaskToSection(id, SECTIONS.NEXT, [SECTIONS.IN_PROGRESS, SECTIONS.RELEASED_BETA, SECTIONS.RELEASED_PAID, SECTIONS.RELEASED_FREE]);
          }

          await asanaAxios.put(`${REQUESTS.TASKS_URL}${approvalSubtask.gid}`, {
            data: {
              approval_status: ci_status,
              html_notes: html_action_url
            },
          });
          continue;
        }

        if (ci_status === "rejected") {
          const approvalSubtasks = await getAllApprovalSubtasks(id, ottoObj);
          deleteApprovalTasks(approvalSubtasks);
          moveTaskToSection(id, SECTIONS.NEXT, [SECTIONS.IN_PROGRESS, SECTIONS.RELEASED_BETA, SECTIONS.RELEASED_PAID, SECTIONS.RELEASED_FREE]);
        }
        addApprovalTask(id, ottoObj, "Automated CI Testing", ci_status, html_action_url);
      }
      return;
    }

    // Get Arrows and Replace Them   
    let commentBody =
      context.payload.comment?.body || context.payload.review?.body || "";
    const isReply = commentBody.charAt(0) === ">";
    if (commentBody.includes(">") || commentBody.includes("<")) {
      if (isReply) {
        const lines = commentBody.split("\n");
        commentBody = lines.filter(function (
          line: string | string[]
        ) {
          return line.indexOf(">") !== 0;
        });
        commentBody.shift();
        commentBody = commentBody.join("")
      } else {
        commentBody = commentBody.replace(/>/g, "");
        commentBody = commentBody.replace(/</g, "");
      }
    }

    // Get Images/Links and Attach Them 
    const links = commentBody.match(
      /\bhttps?:\/\/\S+[\w|\/]/gi
    ) || [];

    links.forEach((link: any) => {
      const linkRegex = link.replace(/\//gi, "\\/");
      const linkSite = link.replace(/.+\/\/|www.|\..+/g, '');
      const capitalLinkSite = linkSite.charAt(0).toUpperCase() + linkSite.slice(1);
      if (commentBody.includes(`src="${link}"`)) {
        const imageRegex = new RegExp(`img[\\w\\W]+?${linkRegex}"`, 'gi');
        commentBody = commentBody.replace(imageRegex, `<a href="${link}"> 🔗 Image Attachment 🔗 </a>`);
      } else if (commentBody.includes(`(${link})`)) {
        const hyperlinkRegex = new RegExp(`\\[(.+?)\\]\\(${linkRegex}\\)`, 'gi');
        var hyperlink = hyperlinkRegex.exec(commentBody) || `🔗 ${capitalLinkSite} Link 🔗 `;
        commentBody = commentBody.replace(hyperlinkRegex, `<a href="${link}"> 🔗 ${hyperlink[1]} 🔗 </a>`);
      } else {
        commentBody = commentBody.replace(link, `<a href="${link}"> 🔗 ${capitalLinkSite} Link 🔗 </a>`);
      }
    });

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

    // Check if PR has Merge Conflicts
    const prMergeConflicts =
      eventName === "issue_comment" &&
      username === "otto-bot-git" &&
      !commentBody.includes("Conflicts have been resolved");

    if (prMergeConflicts) {
      // Move Asana Task To Next Section
      for (const id of asanaTasksIds!) {
        moveTaskToSection(id, SECTIONS.NEXT, [SECTIONS.IN_PROGRESS, SECTIONS.RELEASED_BETA, SECTIONS.RELEASED_PAID, SECTIONS.RELEASED_FREE]);
      }
    }

    // Check if Review Requested OR PR Ready For Review
    if (prReadyForReview) {
      setTimeout(function () {
        for (const reviewer of !DEV_requestedReviewersObjs.length ? QA_requestedReviewersObjs : DEV_requestedReviewersObjs) {
          for (const id of asanaTasksIds!) {
            addRequestedReview(id, reviewer, ottoObj);
          }
        }
      }
        , 30000); // Wait 30 seconds
    }

    if (prReviewRequested) {
      setTimeout(function () {
        for (const reviewer of !DEV_requestedReviewersObjs.length ? QA_requestedReviewersObjs : DEV_requestedReviewersObjs) {
          for (const id of asanaTasksIds!) {
            addRequestedReview(id, reviewer, ottoObj);
          }
        }
      }, Math.floor(Math.random() * (40000 - 15000 + 1) + 20000)); // Wait 15-40 seconds
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
    if (prClosedMerged || prReviewChangesRequested) {
      setTimeout(async () => {
        for (const id of asanaTasksIds!) {
          const approvalSubtasks = await getAllApprovalSubtasks(id, ottoObj);
          deleteApprovalTasks(approvalSubtasks);
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
            addRequestedReview(id, reviewer, ottoObj);
          }
        });
      }

      // Check If Should Move To Approved
      if (is_approved_by_dev && is_approved_by_qa) {
        for (const id of asanaTasksIds!) {
          moveTaskToSection(id, SECTIONS.APPROVED);
        }
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

export const addRequestedReview = async (
  id: String,
  reviewer: any,
  creator: any
) => {
  const approvalSubtask = await getApprovalSubtask(id, false, reviewer, creator);

  // If Request Reviewer already has incomplete subtask
  if (approvalSubtask) {
    return;
  }

  addApprovalTask(id, reviewer, "Review", "pending");
}

export const deleteApprovalTasks = async (
  approvalSubtasks: Array<any>
) => {
  // Delete Approval Tasks
  for (const subtask of approvalSubtasks) {
    await asanaAxios.delete(`${REQUESTS.TASKS_URL}${subtask.gid}`);
  }
}

export const getAllApprovalSubtasks = async (
  id: String,
  creator: any
) => {
  let approvalSubtasks: any = [];
  const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.SUBTASKS_URL}`;
  const subtasks = await asanaAxios.get(url);
  approvalSubtasks = subtasks.data.data.filter(
    (subtask: any) =>
      subtask.resource_subtype === "approval" &&
      !subtask.completed &&
      subtask.created_by.gid === creator?.asanaId
  );
  return approvalSubtasks;
}

export const moveTaskToSection = async (
  id: String,
  moveSection: String,
  donotMoveSections?: Array<String>
) => {
  // Get Task
  const taskUrl = `${REQUESTS.TASKS_URL}${id}`;
  const task = await asanaAxios.get(taskUrl).then((response) => response.data.data);

  for (const membership of task.memberships) {

    // Check If Task Should Not Move
    if (donotMoveSections && donotMoveSections.includes(membership.section.name)) {
      continue;
    }

    // Get Sections of Project
    const projectId = membership.project.gid;
    const sectionsUrl = `${REQUESTS.PROJECTS_URL}${projectId}${REQUESTS.SECTIONS_URL}`;
    const sections = await asanaAxios.get(sectionsUrl).then((response) => response.data.data);

    // Get Section To Move Task To
    const section = sections.find(
      (section: any) =>
        section.name === moveSection
    );

    // Move Task
    const url = `${REQUESTS.SECTIONS_URL}${section.gid}${REQUESTS.ADD_TASK_URL}`;
    await asanaAxios.post(url, {
      data: {
        task: id,
      },
    });
  }
};

export const addApprovalTask = async (
  id: String,
  requestedReviewer: any,
  taskName: String,
  approvalStatus: String,
  notes?: String,
) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Create Approval Subtasks For Requested Reviewer
  await asanaAxios.post(`${REQUESTS.TASKS_URL}${id}${REQUESTS.SUBTASKS_URL}`, {
    data: {
      assignee: requestedReviewer?.asanaId,
      approval_status: approvalStatus,
      completed: false,
      due_on: tomorrow.toISOString().substring(0, 10),
      resource_subtype: "approval",
      name: taskName,
      html_notes: notes ? notes : "<body> </body>"
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
      (subtask.assignee && subtask.assignee.gid === assignee?.asanaId) &&
      subtask.created_by.gid === creator?.asanaId
  );

  return approvalSubtask;
};

run();


