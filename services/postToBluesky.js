import AtpAgent from "@atproto/api";
import splitTextIntoChunks from "../helpers/splitTextIntoChunks";
const BSKY_HANDLE = process.env.BSKY_HANDLE;
const BSKY_APP_PASSWORD = process.env.BSKY_APP_PASSWORD;

const postToBluesky = async (text, images) => {
  const agent = new AtpAgent({ service: "https://bsky.social" });

  try {
    console.log("Logging into Bluesky...");
    await agent.login({ identifier: BSKY_HANDLE, password: BSKY_APP_PASSWORD });

    // Function to clean up links and remove Twitter ellipses
    const cleanText = (inputText) => {
      return inputText.replace(/\bhttps?:\/\/\S+…/g, (match) =>
        match.replace(/…$/, "")
      );
    };

    // Extract hashtags and links with positions
    const extractFacets = (inputText) => {
      let facets = [];
      let cleanText = inputText;

      // Find links
      const linkRegex = /\bhttps?:\/\/[^\s]+/g;
      cleanText = cleanText.replace(linkRegex, (match, offset) => {
        facets.push({
          index: { byteStart: offset, byteEnd: offset + match.length },
          features: [{ $type: "app.bsky.richtext.facet#link", uri: match }],
        });
        return match;
      });

      // Find hashtags
      const hashtagRegex = /#[A-Za-z0-9_]+/g;
      cleanText = cleanText.replace(hashtagRegex, (match, offset) => {
        facets.push({
          index: { byteStart: offset, byteEnd: offset + match.length },
          features: [
            {
              $type: "app.bsky.richtext.facet#tag",
              tag: match.slice(1), // removes the '#' character
            },
          ],
        });
        return match;
      });

      return { cleanText, facets };
    };

    // Process text
    text = cleanText(text);
    let { cleanText: processedText, facets } = extractFacets(text);
    let chunks = splitTextIntoChunks(processedText, 290);

    let rootPostUri = null;
    let rootPostCid = null;
    let previousPostUri = null;
    let previousPostCid = null;

    for (let i = 0; i < chunks.length; i++) {
      let chunk = chunks[i];

      // Only add the thread emoji if there is more than one chunk and this is the first chunk
      if (chunks.length > 1 && i === 0) {
        chunk = chunk + " 🧵";
      }

      let postData = {
        text: chunk,
        createdAt: new Date().toISOString(),
        facets: facets.filter((facet) => facet.index.byteStart < chunk.length), // Apply only relevant facets
      };

      // Attach images only to the first post
      if (images.length > 0 && rootPostUri === null) {
        console.log("Uploading images to Bluesky...");
        const uploadedImages = await Promise.all(
          images.map(async (url) => {
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

      // Thread handling
      if (previousPostUri) {
        postData.reply = {
          root: { uri: rootPostUri, cid: rootPostCid },
          parent: { uri: previousPostUri, cid: previousPostCid },
        };
      }

      console.log("Posting chunk to Bluesky:", chunk);
      const response = await agent.post(postData);

      if (!rootPostUri) {
        rootPostUri = response.uri;
        rootPostCid = response.cid;
      }

      previousPostUri = response.uri;
      previousPostCid = response.cid;

      console.log("✅ Successfully posted a chunk!");
    }
  } catch (error) {
    console.error("❌ Error posting to Bluesky:", error);
  }
};

export default postToBluesky;
