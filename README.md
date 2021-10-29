# Automate GitHub pull request notifications in Asana

When a pull request is updated, this GitHub Action will automatically notify Asana task collaborators for seamless communication. 

How does it work? The GitHub Action will check the description of the pull request for the specific Asana task URL to comment on. The action will then comment on the Asana task as the authenticated Asana user.

This is available to all Asana users on Premium, Business, and Enterprise plans. 

To automatically connect pull request attachments from GitHub to Asana tasks in the pull request description, check out [GitHub Action](https://github.com/Asana/create-app-attachment-github-action).

To learn more about using the GitHub + Asana integration, visit the [Asana Guide](https://asana.com/guide/help/api/github).

## Usage

#### Step 1: Generate a secret token for your Action

Skip this step if you've done this for a different GitHub action for this repository.

* Go to https://github.integrations.asana.plus/auth?domainId=ghactions.
* Authorize the Asana app and the GitHub app.
* Copy the generated secret. **Do not share this secret with anyone!**

At any point, you can revoke this generated token at https://github.integrations.asana.plus/auth?domainId=manage_tokens.

#### Step 2: Set up a repository secret for the secret token

Skip this step if you've done this for a different GitHub action for this repository.

* Go to settings page for your repository.
* Click on *Secrets* on left sidebar.
* Click **New repository secret**.
* Create a new secret called `ASANA_SECRET` with value set to the secret token.
* Click **Add secret**.

#### Step 3: Create a workflow file

##### Quick Start for Unix Command Line
To get started quickly, `cd` into the GitHub repository root and checkout the main branch

```sh
cd <REPOSITORY ROOT>
git checkout main
```

Then, run the commands below from the command line to create a workflow file, commit the change, and push it to GitHub. 

```sh
mkdir -p .github/workflows && curl https://raw.githubusercontent.com/Asana/comment-on-task-github-action/main/example-workflow-file.yaml --output .github/workflows/comment-on-task.yaml
git add .github/workflows/comment-on-task.yaml
git commit -m "automatically comment on Asana task when pull request status changes"
git push
```

The action should work after this step and post comments on Asana tasks whenever someone opens, closes, merges, or reopens a pull request with a default comment text. You should now see a file called `.github/workflows/comment-on-task.yaml` in your repository on GitHub.  Find out how to edit what events trigger the action and how to change the comment text in the next section.

##### Step-by-Step

Instead of running the commands in the previous section, you can create a YAML file with a name of your choosing in `.github/workflows/` directory (e.g, `.github/workflows/add-asana-comment.yml`. You may have to create the directory.). We provide an example [`.github/workflows/add-asana-comment.yml`](https://raw.githubusercontent.com/Asana/comment-on-task-github-action/main/example-workflow-file.yaml) file below.

```yaml
on:
  pull_request:
    types: [opened, closed, reopened]

jobs:
  create-comment-in-asana-task-job:
    runs-on: ubuntu-latest
    name: Create a comment in Asana Task
    steps:
      - name: Create a comment
        uses: Asana/comment-on-task-github-action@latest
        id: createComment
        with:
          asana-secret: ${{ secrets.ASANA_SECRET }}
          comment-text: "{{PR_NAME}} is {{PR_STATE}}: {{PR_URL}}"
      - name: Get status
        run: echo "Status is ${{ steps.createComment.outputs.status }}"
```

The workflow set up in the file above will run whenever a pull request is opened, closed (including merged), or reopened. This GitHub action only runs in the context of a pull request so the event triggers must either be the [`pull_request`](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request) event, the [`pull_request_review_comment`](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review_comment) event, or the [`pull_request_review`](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review) event. 

Once this file is set up, commit and push your change to the **main branch of your repository.** The GitHub action is now set up, congratulations!

#### Step 4: Adapt the GitHub Action to your workflow (optional)

##### Available parameters

*Required*:

* ```asana-secret``` - Should contain Asana secret from Step 3
* ```comment-text``` - Comment to send to Asana task. You can use the following placeholders in your comment text:
  * ```{{PR_URL}}``` - pull request link
  * ```{{PR_ID}}``` - pull request number
  * ```{{PR_NAME}}``` - pull request name
  * ```{{PR_STATE}}```  - pull request state (opened, closed, merged)

*Optional*:

* ```allowed-projects``` - List of Asana projects IDs where comments can be added
* ```blocked-projects``` - List of Asana projects IDs where comments cannot be added

If values are provided for neither the `allowed-projects` parameter or the `blocked-projects` parameter, the GitHub action will be able to comment on any task in the workspace. Providing values for both ```allowed-projects``` and ```blocked-projects``` lists at the same time will result in an error.

In the workflow file below, we provide an allowlist to the GitHub Action. The Action will only comment on tasks that are in project 1125036528002799 or 1192160553314033.

``` yaml
jobs:
  create-comment-in-asana-task-job:
    runs-on: ubuntu-latest
    name: Comment on Asana Task
    steps:
      - name: Create a comment
        uses: Asana/comment-on-task-github-action@latest
        id: createComment
        with:
          asana-secret: ${{ secrets.ASANA_SECRET }}
          comment-text: "Your comment"
          allowed-projects: |
            1125036528002799
            1192160553314033
      - name: Get status
        run: echo "Status is ${{ steps.createComment.outputs.status }}"
```

In the workflow file below, we provide an allowlist to the GitHub Action. The Action will only comment on tasks that are **not** in project 1125036528002799 or 1192160553314033.

```yaml
jobs:
  create-comment-in-asana-task-job:
    runs-on: ubuntu-latest
    name: Create a comment in Asana Task
    steps:
      - name: Create a comment
        uses: Asana/comment-on-task-github-action@latest
        id: createComment
        with:
          asana-secret: ${{ secrets.ASANA_SECRET }}
          comment-text: "Your comment"
          blocked-projects: |
            1125036528002799
            1192160553314033
      - name: Get status
        run: echo "Status is ${{ steps.createComment.outputs.status }}"
```

#### Revoking your secret token

If at any point you want to stop using your GitHub action or want to rotate your secret token, you may invalidate all of your tokens at https://github.integrations.asana.plus/auth?domainId=manage_tokens

## Contributing

### Unit tests

Unit tests should be run via npm command:

```npm run test```

### Formatting and Linting

```npm run lint```
