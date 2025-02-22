import tumblr from "tumblr.js";

const TUMBLR_CONSUMER_KEY = process.env.TUMBLR_CONSUMER_KEY;
const TUMBLR_CONSUMER_SECRET = process.env.TUMBLR_CONSUMER_SECRET;
const TUMBLR_TOKEN = process.env.TUMBLR_TOKEN;
const TUMBLR_TOKEN_SECRET = process.env.TUMBLR_TOKEN_SECRET;
const TUMBLR_BLOG_IDENTIFIER = process.env.TUMBLR_BLOG_IDENTIFIER;

const postToTumblr = async (text, images = []) => {
  const client = tumblr.createClient({
    consumer_key: TUMBLR_CONSUMER_KEY,
    consumer_secret: TUMBLR_CONSUMER_SECRET,
    token: TUMBLR_TOKEN,
    token_secret: TUMBLR_TOKEN_SECRET,
  });

  try {
    // Extract hashtags from text
    const hashtags = text.match(/#\w+/g) || [];
    const tags = hashtags;
    text = text.replace(/#\w+/g, "").trim();

    // Find links in the text and format them
    const linkRegex = /(https?:\/\/\S+)/g;
    let formattedText = text;
    let formatting = [];
    let match;
    while ((match = linkRegex.exec(text)) !== null) {
      formatting.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "link",
        url: match[0].replace(/\bhttps?:\/\/\S+…/g, (match) =>
          match.replace(/…$/, "")
        ),
      });
    }

    if (images.length > 0) {
      console.log("Uploading images to Tumblr...");

      // Construct the media array from the images array
      const mediaArray = images.map((imageUrl) => ({
        type: "image/jpeg",
        url: imageUrl,
      }));

      console.log("✅ Uploaded images, posting to Tumblr...");

      console.log(
        JSON.stringify({
          content: [
            {
              type: "image",
              media: mediaArray,
              formatting: formatting,
            },
            {
              type: "text",
              text: formattedText || "",
              formatting: formatting,
            },
          ],
          state: "published",
          tags: tags,
        })
      );

      await client.createPost(TUMBLR_BLOG_IDENTIFIER, {
        content: [
          // @ts-ignore
          {
            type: "image",
            media: mediaArray,
            formatting: formatting,
          },
          {
            type: "text",
            text: formattedText || "",
            formatting: formatting,
          },
        ],
        state: "published",
        tags: tags,
      });

      console.log("✅ Successfully posted photo post to Tumblr!");
    } else {
      console.log("Posting text post to Tumblr...");

      await client.createPost(TUMBLR_BLOG_IDENTIFIER, {
        content: [
          {
            type: "text",
            text: formattedText,
            formatting: formatting,
          },
        ],
        state: "published",
        tags: tags,
      });

      console.log("✅ Successfully posted text post to Tumblr!");
    }
  } catch (error) {
    console.error("❌ Error posting to Tumblr:", error);
  }
};

export default postToTumblr;
