# Automate GitHub pull request notifications in Asana

When a pull request is updated, this GitHub Action will automatically notify Asana task collaborators for seamless communication. 

How does it work? The GitHub Action will check the description of the pull request for the specific Asana task URL to comment on. The action will then comment on the Asana task as the authenticated user.

This is available to all Asana users on Premium, Business, and Enterprise plans. 

To automatically connect pull request attachments from GitHub to Asana tasks in the pull request description, check out [GitHub action](https://github.com/Asana/create-app-attachment-github-action).

To learn more about using the GitHub + Asana integration, visit the [Asana Guide](https://asana.com/guide/help/api/github).

## Usage

#### Step 1: Generate a secret token for your Action

* Go to https://github.integrations.asana.plus/auth?domainId=ghactions.
* Authorize the Asana app and the GitHub app.
* Copy the generated secret.

#### Step 2: Set up a repository secret for the secret token

* Go to settings page for your repository.
* Click on *Secrets* on left sidebar.
* Click **New repository secret**.
* Create a new secret called `ASANA_SECRET` with value set to the secret token.
* Click **Add secret**.

#### Step 3: Create a workflow file

Pick a name and create a `.yml` workflow file with that name in the `.github/workflows/` directory (e.g, `.github/workflows/add-asana-comment.yml`). 

This GitHub action only runs in the context of a pull request so the event triggers must either be the [`pull_request`](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request) event, the [`pull_request_review_comment`](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review_comment) event, or the [`pull_request_review`](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review) event. Below is an example `.github/workflows/add-asana-comment.yml` file.

```yaml
on:
  pull_request:
    types: [opened, reopened]

jobs:
  create-comment-in-asana-task-job:
    runs-on: ubuntu-latest
    name: Create a comment in Asana Task
    steps:
      - name: Create a comment
        uses: Asana/comment-on-task-github-action@v1.0
        id: createComment
        with:
          asana-secret: ${{ secrets.ASANA_SECRET }}
          comment-text: "{{PR_NAME}} is {{PR_STATE}}: {{PR_URL}}"
      - name: Get status
        run: echo "Status is ${{ steps.createComment.outputs.status }}"
```

#### Step 4: Adapt the GitHub Action to your workflow

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
        uses: Asana/comment-on-task-github-action@v1.0
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
        uses: Asana/comment-on-task-github-action@v1.0
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

## Contributing

### Unit tests

Unit tests should be run via npm command:

```npm run test```

### Formatting and Linting

```npm run lint```
