# Asana GitHub Action for create a comment in Asana task

This action allows you to create a comment in Asana task.
Links to the Asana tasks must be added in the description of the Pull Request (before the Pull Request is created).

## Usage

### Step 1: Prepare values for setting up your variables for Actions

* Go to the https://github.integrations.asana.plus/auth?domainId=ghactions
* After authorization flow you'll see your Asana secret, please click on "Copy" button

### Step 2: Configure Secrets in your GitHub repository

On GitHub, go in your repository settings, click on *Secrets* and create a new secret called ```ASANA_SECRET``` and add paste Asana secret from the previous step

### Step 3: Add action to your .github/workflows/ directory

To use the action simply create an ```create-asana-comment.yml``` (or choose custom *.yml name) in the .github/workflows/ directory.

### Step 4: Example Workflow Template

Please make sure you use ```pull_request``` as your action trigger, other triggers are not supported

```
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
          comment-text: "{{PR_NAME}} was {{PR_STATE}}, link - {{PR_URL}}"
      - name: Get status
        run: echo "Status is ${{ steps.createComment.outputs.status }}"
```

### Step 5: Configure the GitHub Action if need to adapt for your needs or workflows

#### Available parameters

*Required*:
* ```asana-secret``` - Should contain Asana secret from Step 3
* ```comment-text``` - Comment to send to Asana task. You can use the following placeholders in your comment text:
    * ```{{PR_URL}}``` - Link to GitHub Pull Request
    * ```{{PR_ID}}``` - Id of Pull Request
    * ```{{PR_NAME}}``` - Name of Pull Request
    * ```{{PR_STATE}}```  - State of Pull Request (opened, closed, merged)

*Optional*:
* ```allowed-projects``` - List of Asana projects gids where comment can be added
* ```blocked-projects``` - List of Asana projects gids where comment cannot be added

If both lists are empty, comments can be added to any task that was parsed from the Pull Request description
Using both ```allowed-projects``` and ```blocked-projects``` lists at the same time will result in an error

#### Examples of use allowed and blocked lists

``` 
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
          allowed-projects: |
            1125036528002799
            1192160553314033
      - name: Get status
        run: echo "Status is ${{ steps.createComment.outputs.status }}"
```

```
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
