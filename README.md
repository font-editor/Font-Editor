# Font Foundry

A free browser-based font editor. Open `index.html` locally or publish this folder with GitHub Pages.

## Publish with GitHub Pages

1. Create a new public GitHub repository.
2. Upload `index.html` and `robots.txt` to the repository's root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. Wait for GitHub Pages to publish the site and open the URL shown there.

## Google indexing

Publishing does not guarantee immediate Google results. Once the GitHub Pages URL is live:

1. Add the site in [Google Search Console](https://search.google.com/search-console/).
2. Verify ownership using one of the methods Google offers.
3. Use **URL Inspection** to request indexing of the homepage.

Google may take days or longer to crawl and index a new site. Search Console can report whether the page was discovered or indexed.

A sitemap is not included yet because it needs the final public GitHub Pages URL. Once the repository name and GitHub username are known, create a `sitemap.xml` containing the exact homepage URL and add its location to `robots.txt`.
