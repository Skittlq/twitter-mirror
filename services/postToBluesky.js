import { AtpAgent } from "@atproto/api";
import splitTextIntoChunks from "../helpers/splitTextIntoChunks.js";
const BSKY_HANDLE = process.env.BSKY_HANDLE;
const BSKY_APP_PASSWORD = process.env.BSKY_APP_PASSWORD;

const postTweetsToBluesky = async (tweets) => {
  const agent = new AtpAgent({ service: "https://bsky.social" });

  try {
    await agent.login({ identifier: BSKY_HANDLE, password: BSKY_APP_PASSWORD });

    const cleanText = (inputText, urls = []) => {
      let workingText = inputText;

      // Sort URLs by their start index in descending order to avoid messing up indices while inserting.
      urls.sort((a, b) => b.indices[0] - a.indices[0]);

      // Insert URLs into the text at the correct positions.
      urls.forEach((urlObj) => {
        const start = urlObj.indices[0];
        const urlText = urlObj.expanded_url;
        workingText =
          workingText.slice(0, start) + urlText + workingText.slice(start);
      });

      return workingText;
    };

    const extractFacets = (inputText, urls = []) => {
      let facets = [];
      let workingText = inputText;

      // Extract links from text using regex.
      const linkRegex = /\bhttps?:\/\/[^\s]+/g;
      workingText = workingText.replace(linkRegex, (match, offset) => {
        facets.push({
          index: { byteStart: offset, byteEnd: offset + match.length },
          features: [{ $type: "app.bsky.richtext.facet#link", uri: match }],
        });
        return match;
      });

      // Extract hashtags.
      const hashtagRegex = /#[A-Za-z0-9_]+/g;
      workingText = workingText.replace(hashtagRegex, (match, offset) => {
        facets.push({
          index: { byteStart: offset, byteEnd: offset + match.length },
          features: [
            {
              $type: "app.bsky.richtext.facet#tag",
              tag: match.slice(1),
            },
          ],
        });
        return match;
      });

      // Add URL facets from tweet.urls.
      if (urls && Array.isArray(urls)) {
        urls.forEach((urlObj) => {
          if (urlObj.indices && urlObj.indices.length === 2) {
            facets.push({
              index: {
                byteStart: urlObj.indices[0],
                byteEnd: urlObj.indices[0] + urlObj.expanded_url.length,
              },
              features: [
                {
                  $type: "app.bsky.richtext.facet#link",
                  uri: urlObj.expanded_url,
                },
              ],
            });
          }
        });
      }

      return { cleanText: workingText, facets };
    };

    const postTweetThread = async (
      tweet,
      parentReply = null,
      threadRoot = null
    ) => {
      let rootPostUri = threadRoot ? threadRoot.uri : null;
      let rootPostCid = threadRoot ? threadRoot.cid : null;
      let previousPost = parentReply ? parentReply : null;

      // Pass tweet.urls to add facets for separated URLs.
      const { cleanText: processedText, facets } = extractFacets(
        cleanText(tweet.text, tweet.urls),
        tweet.urls
      );
      const chunks = splitTextIntoChunks(processedText, 290);

      for (let i = 0; i < chunks.length; i++) {
        let chunk = chunks[i];
        if (chunks.length > 1 && i === 0) {
          chunk = chunk + " 🧵";
        }

        let postData = {
          text: chunk,
          createdAt: new Date().toISOString(),
          facets: facets.filter(
            (facet) => facet.index.byteStart < chunk.length
          ),
        };

        if (i === 0 && tweet.images && tweet.images.length > 0) {
          const uploadedImages = await Promise.all(
            tweet.images.map(async (url) => {
              const res = await fetch(url);
              const imageBuffer = await res.arrayBuffer();
              return await agent.uploadBlob(new Uint8Array(imageBuffer), {
                encoding: "image/png",
              });
            })
          );
          postData.embed = {
            $type: "app.bsky.embed.images",
            images: uploadedImages.map((img) => ({
              image: img.data.blob,
              alt: "Tweet Image",
            })),
          };
        }

        if (previousPost) {
          postData.reply = {
            root: { uri: rootPostUri, cid: rootPostCid },
            parent: { uri: previousPost.uri, cid: previousPost.cid },
          };
        }

        const response = await agent.post(postData);

        if (!rootPostUri) {
          rootPostUri = response.uri;
          rootPostCid = response.cid;
        }
        previousPost = { uri: response.uri, cid: response.cid };
      }
      return { uri: rootPostUri, cid: rootPostCid, last: previousPost };
    };

    for (const tweetData of tweets) {
      try {
        if (Array.isArray(tweetData)) {
          let threadInfo = null;
          for (const tweet of tweetData) {
            threadInfo = await postTweetThread(
              tweet,
              threadInfo ? threadInfo.last : null,
              threadInfo ? { uri: threadInfo.uri, cid: threadInfo.cid } : null
            );
          }
        } else {
          await postTweetThread(tweetData);
        }
      } catch (error) {
        console.error("❌ Error posting a tweet:", error);
      }
    }
  } catch (error) {
    console.error("❌ Error logging into Bluesky:", error);
  }
};

export default postTweetsToBluesky;
