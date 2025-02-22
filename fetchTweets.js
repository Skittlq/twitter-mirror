import puppeteer from "puppeteer";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const X_USERNAME = process.env.X_USERNAME;
const X_PASSWORD = process.env.X_PASSWORD;

const checkForNewTweets = async () => {
  let finalOrganisedTweets = [];
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: "./user_data", // Persistent session storage
  });
  const page = await browser.newPage();

  try {
    // Intercept network requests
    await page.setRequestInterception(true);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();

      // Check if the URL matches either of your patterns
      if (
        url.includes(
          "https://x.com/i/api/graphql/Y9WM4Id6UcGFE8Z-hbnixw/UserTweets"
        ) ||
        url.includes(
          "https://x.com/i/api/graphql/Ez6kRPyXbqNlhBwcNMpU-Q/TweetDetail"
        )
      ) {
        request.continue();
      } else {
        request.continue();
      }
    });

    page.on("response", async (response) => {
      if (
        response
          .url()
          .includes(
            "https://x.com/i/api/graphql/Y9WM4Id6UcGFE8Z-hbnixw/UserTweets"
          )
      ) {
        const data = await response.json();
        const tweets =
          data.data.user.result.timeline_v2.timeline.instructions[1].entries;

        const organisedTweets = await Promise.all(
          tweets.map(async (entry) => {
            const entryType = entry.entryId.replace(/-\d+$/, "");

            if (entryType === "tweet") {
              const tweet =
                entry?.content?.itemContent?.tweet_results.result?.legacy;
              const tweetId =
                entry?.content?.itemContent?.tweet_results.result?.rest_id;

              const isRetweeted = tweet?.retweeted === true;

              if (isRetweeted) {
                const retweetedUser =
                  tweet?.retweeted_status_result?.result?.core?.user_results
                    ?.result?.legacy;
                const username = retweetedUser?.screen_name;

                // Construct plain-text content: "RT @username" followed by the original tweet text
                const textField = `Retweet from \n\nOriginal Tweet: `;

                // "Retweet from " is 13 characters.
                const usernameLinkStart = 13;
                const usernameLinkText = `https://x.com/${username}`;
                const usernameLinkEnd =
                  usernameLinkStart + usernameLinkText.length;

                return [
                  {
                    text: textField,
                    images: [],
                    quote: tweet?.quoted_status_permalink?.expanded || null,
                    url: `https://x.com/${username}/status/${tweetId}`,
                    retweeted: true,
                    quote_retweeted: tweet?.quoted_status_permalink?.expanded
                      ? true
                      : false,
                    urls: [
                      {
                        display_url: `x.com/${username}`,
                        expanded_url: `https://x.com/${username}`,
                        url: `https://x.com/${username}`, // Replace with the shortened t.co URL if available
                        indices: [usernameLinkStart, usernameLinkEnd],
                      },
                      // Add the original tweet URL to the URLs array
                      {
                        display_url: `x.com/${username}/status/${tweetId}`,
                        expanded_url: `https://x.com/${username}/status/${tweetId}`,
                        url: `https://x.com/${username}/status/${tweetId}`, // Replace with the shortened t.co URL if available
                        indices: [
                          usernameLinkEnd + 2 + "Original Tweet: ".length,
                          usernameLinkEnd +
                            2 +
                            "Original Tweet: ".length +
                            `https://x.com/${username}/status/${tweetId}`
                              .length,
                        ],
                      },
                    ],
                  },
                ];
              }

              return [
                {
                  text: tweet?.full_text.replace(/https:\/\/t\.co\/\w+/g, ""),
                  images:
                    tweet?.extended_entities?.media.map((media) =>
                      media.media_url_https.startsWith(
                        "https://pbs.twimg.com/ext_tw_video_thumb"
                      )
                        ? media.video_info.variants[3].url
                        : media.media_url_https
                    ) || [],
                  quote: tweet?.quoted_status_permalink?.expanded || null,
                  url: `https://x.com/${X_USERNAME}/status/${tweetId}`,
                  retweeted: isRetweeted || false,
                  quote_retweeted: tweet?.quoted_status_permalink?.expanded
                    ? true
                    : false,
                  urls: tweet?.entities?.urls || [],
                },
              ];
            } else if (entryType === "profile-conversation") {
              const tweetsWithReplies = entry?.content?.items;

              return tweetsWithReplies.map((badTweet) => {
                const tweet =
                  badTweet?.item?.itemContent?.tweet_results?.result?.legacy;
                const tweetId =
                  badTweet?.item?.itemContent?.tweet_results?.result?.rest_id;
                const isRetweeted = tweet?.retweeted === true;

                return {
                  text: tweet?.full_text.replace(/https:\/\/t\.co\/\w+/g, ""),
                  images:
                    tweet?.extended_entities?.media.map((media) =>
                      media.media_url_https.startsWith(
                        "https://pbs.twimg.com/ext_tw_video_thumb"
                      )
                        ? media.video_info.variants[3].url
                        : media.media_url_https
                    ) || [],
                  retweeted: isRetweeted || false,
                  quote_retweeted: tweet?.quoted_status_permalink?.expanded
                    ? true
                    : false,
                  retweeted: tweet?.retweeted,
                  url: `https://twitter.com/${X_USERNAME}/status/${tweetId}`,
                  urls: tweet?.entities?.urls || [],
                };
              });
            } else {
              return null;
            }
          })
        );

        finalOrganisedTweets = finalOrganisedTweets
          .concat(organisedTweets)
          .filter((tweet) => tweet !== null);
      }
    });

    // First, navigate to your timeline to check if you're already logged in
    await page.goto(`https://x.com/${X_USERNAME}`, {
      waitUntil: "domcontentloaded",
    });

    await new Promise((r) => setTimeout(r, 5000));

    // Look for a login selector. If found, then you're not logged in.
    const loginInput = await page.$('input[name="text"]');
    if (loginInput) {
      // Navigate to the login page
      await page.goto("https://x.com/login", { waitUntil: "domcontentloaded" });

      // Perform the login steps
      await page.waitForSelector('input[name="text"]', { visible: true });
      await page.type('input[name="text"]', X_USERNAME);
      await page.keyboard.press("Enter");

      await new Promise((r) => setTimeout(r, 5000));

      await page.waitForSelector('input[name="password"]', { visible: true });
      await page.type('input[name="password"]', X_PASSWORD);
      await page.keyboard.press("Enter");

      await new Promise((r) => setTimeout(r, 5000));

      // After logging in, go to your timeline
      await page.goto(`https://x.com/${X_USERNAME}`, {
        waitUntil: "domcontentloaded",
      });
    } else {
    }

    await new Promise((r) => setTimeout(r, 5000));

    // For each finalOrganisedTweets, check if the item is an array, if so then get the last item of the array and navigate to the url of the tweet and intercept the https://x.com/i/api/graphql/Ez6kRPyXbqNlhBwcNMpU-Q/TweetDetail request's response
    for (const [index, tweet] of finalOrganisedTweets.entries()) {
      if (Array.isArray(tweet) && tweet.length > 1) {
        const lastTweet = tweet[tweet.length - 1];
        await page.goto(lastTweet.url, { waitUntil: "domcontentloaded" });

        const responseHandler = async (response) => {
          if (
            response
              .url()
              .includes(
                "https://x.com/i/api/graphql/Ez6kRPyXbqNlhBwcNMpU-Q/TweetDetail"
              )
          ) {
            const data = await response.json();

            let thread =
              data.data.threaded_conversation_with_injections_v2.instructions[0].entries.map(
                (entry) => {
                  const tweet =
                    entry?.content?.itemContent?.tweet_results?.result?.legacy;
                  const tweetId =
                    entry?.content?.itemContent?.tweet_results?.result?.rest_id;
                  const entryType = entry.entryId.replace(/-\d+$/, "");
                  const isRetweeted = tweet?.retweeted === true;

                  if (entryType !== "tweet") {
                    return null;
                  }

                  return {
                    text: tweet?.full_text.replace(/https:\/\/t\.co\/\w+/g, ""),
                    images:
                      tweet?.extended_entities?.media.map((media) =>
                        media.media_url_https.startsWith(
                          "https://pbs.twimg.com/ext_tw_video_thumb"
                        )
                          ? media.video_info.variants[3].url
                          : media.media_url_https
                      ) || [],
                    quote: tweet?.quoted_status_permalink?.expanded || null,
                    url: `https://twitter.com/${X_USERNAME}/status/${tweetId}`,
                    retweeted: isRetweeted || false,
                    quote_retweeted: tweet?.quoted_status_permalink?.expanded
                      ? true
                      : false,
                    urls: tweet?.entities?.urls || [],
                  };
                }
              );

            thread = thread.filter((tweet) => tweet !== null);
            finalOrganisedTweets[index] = thread;

            // Remove the event listener after handling the response
            page.off("response", responseHandler);
          }
        };

        page.on("response", responseHandler);

        // Wait for some time to ensure the request is intercepted
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    return finalOrganisedTweets;
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await browser.close();
  }
};

export default checkForNewTweets;
