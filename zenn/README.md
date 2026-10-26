# Zenn publishing

Articles for https://zenn.dev/theoj are managed in the root `articles/` directory. Zenn Connect syncs changes pushed or merged to `main` after the GitHub connection is installed and approved.

## Create an article

From the repository root:

```sh
cp zenn/article-template.md articles/my-first-article.md
```

Edit the title, emoji, topics, and body. Use a unique slug (the filename without `.md`) containing 12–50 lowercase letters, numbers, hyphens, or underscores. Keep that filename when updating an existing article.

Commit the article and push it to `main`, or merge an article PR into `main`. With `published: false`, it syncs as a Zenn draft. After reviewing the content, set `published: true` and push again to publish.

Zenn uses one Markdown file per article, directly under `articles/`; an empty folder or a per-article subfolder is not a post. Keep this guide and the template outside `articles/` so they are not deployed as articles.

## Images

Store article assets in `images/<article-slug>/` and reference them with an absolute repository path:

```md
![説明](/images/my-first-article/example.png)
```

## Optional local preview

Node.js and npm are required for this command. From the repository root:

```sh
npx --yes --package zenn-cli zenn preview
```

Open http://localhost:8000. The CLI is optional; Zenn Connect handles deployment without an API key or a GitHub Actions workflow.

## Verify deployment

Check https://zenn.dev/dashboard/deploys for the connected repository, branch, and deployment logs. Drafts appear at https://zenn.dev/dashboard. Avoid `[skip ci]` or `[ci skip]` in article commit messages because they skip Zenn deployments too.

This repository is public, so draft Markdown and images committed here are publicly readable on GitHub. Deleting an article file from GitHub does not delete the article on Zenn; use the Zenn dashboard for deletion.

Official guides:

- https://zenn.dev/zenn/articles/connect-to-github
- https://zenn.dev/zenn/articles/zenn-cli-guide
