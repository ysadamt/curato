import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleGenerativeAI, SchemaType, Tool } from "@google/generative-ai";

// --- Interfaces remain the same ---
interface ArtsyApiSuccessData {
  artworksConnection?: {
    edges: any[];
    pageInfo: any; // Make sure pageInfo is always included
  } | null;
}

interface ErrorResponse {
  error: string;
}

// --- convertNaturalLanguageToArtsyParams remains the same ---
async function convertNaturalLanguageToArtsyParams(
  query: string
): Promise<Record<string, any>> {
  // ... (keep existing implementation)
  // No changes needed here for pagination itself, as it only generates
  // the *filters*, not the pagination cursor.
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("API key is not defined");
  }
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: "gemini-1.5-flash", // Updated model name if needed
    systemInstruction:
      "You are an assistant that converts user requests into structured parameters for searching artworks on Artsy using the provided tool. Only use the tool to respond.",
  });

  const artsySearchTool: Tool = {
    functionDeclarations: [
      {
        name: "searchArtsyArtworks",
        description:
          "Searches the Artsy database for artworks based on various criteria provided by the user.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            artistIDs: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
              description:
                "Array of Artsy artist slugs or IDs (e.g., ['pablo-picasso', 'andy-warhol']). Extract slugs if names are mentioned.",
            },
            keyword: {
              type: SchemaType.STRING,
              description:
                "General keyword search term (searches title, artist names, medium, etc.). Use if specific fields aren't identified or as a fallback. This is the primary search field.",
            },
            medium: {
              type: SchemaType.STRING,
              description:
                "The medium of the artwork (e.g., 'painting', 'sculpture', 'photography', 'prints'). Use Artsy's controlled vocabulary if possible.",
            },
            color: {
              type: SchemaType.STRING,
              description:
                "A dominant color in the artwork (e.g., 'red', 'blue', 'black').",
            },
            partnerIDs: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
              description:
                "IDs or slugs of specific galleries or institutions, if mentioned.",
            },
            forSale: {
              type: SchemaType.BOOLEAN,
              description:
                "Filter for artworks currently marked as for sale, if the user asks.",
            },
            attributionClass: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
              description:
                "Filter by attribution class like 'unique', 'limited edition', 'open edition', if mentioned.",
            },
            priceRange: {
              type: SchemaType.STRING,
              description:
                "A price range string like '1000-5000' or '*-10000' (for under 10k), if mentioned by user.",
            },
          },
          // Keep keyword required for initial clarity, but handle fallbacks
          required: ["keyword"],
        },
      },
    ],
  };

  const chat = model.startChat({
    tools: [artsySearchTool],
  });

  try {
    const prompt = `Please analyze this user request and extract the relevant parameters for searching artworks on Artsy: "${query}"`;

    const result = await chat.sendMessage(prompt);
    const response = result.response;
    const functionCalls = response.functionCalls();

    if (
      functionCalls &&
      functionCalls.length > 0 &&
      functionCalls[0].name === "searchArtsyArtworks"
    ) {
      const args = functionCalls[0].args;
      console.log("Gemini extracted parameters:", args);

      // Basic cleaning (remove null/undefined/empty arrays)
      const cleanedArgs: Record<string, any> = {};
      for (const key in args) {
        if (Object.prototype.hasOwnProperty.call(args, key)) {
          const value = (args as Record<string, any>)[key];
          // Check for undefined, null, or empty string/array specifically
          if (value !== undefined && value !== null) {
            if (Array.isArray(value) && value.length === 0) {
              continue; // Skip empty arrays
            }
            if (typeof value === "string" && value.trim() === "") {
              continue; // Skip empty strings
            }
            cleanedArgs[key] = value;
          }
        }
      }

      // Fallback logic: If cleanedArgs is empty or only contains empty/nullish values, use original query as keyword
      if (
        Object.keys(cleanedArgs).length === 0 ||
        !Object.values(cleanedArgs).some(
          (v) =>
            v !== undefined &&
            v !== null &&
            v !== "" &&
            (!Array.isArray(v) || v.length > 0)
        )
      ) {
        console.warn(
          "Gemini returned effectively empty args, falling back to using the full query as keyword."
        );
        return { keyword: query };
      }

      // Ensure keyword exists if other specific fields (like artistIDs, medium) aren't present
      // This logic might need refinement depending on how you want Artsy search to behave
      if (
        !cleanedArgs.keyword &&
        !cleanedArgs.artistIDs &&
        !cleanedArgs.medium &&
        !cleanedArgs.color
      ) {
        // Add other potential primary fields if necessary
        console.log(
          "Adding original query as keyword fallback since specific primary fields are missing."
        );
        cleanedArgs.keyword = query;
      }

      return cleanedArgs;
    } else {
      console.warn(
        "Gemini did not return expected function call. Falling back to keyword search."
      );
      return { keyword: query }; // Fallback to using the raw query
    }
  } catch (error) {
    console.error("Error during Gemini parameter extraction:", error);
    console.warn("Falling back to keyword search due to error.");
    return { keyword: query }; // Fallback on error
  }
}

// --- queryArtsy: Modified to accept and use the 'after' cursor ---
async function queryArtsy(
  params: Record<string, any>,
  after?: string | null // Optional 'after' cursor parameter
): Promise<any> {
  const token = process.env.ARTSY_ACCESS_TOKEN!;
  const userId = process.env.ARTSY_USER_ID!;
  const artsyApiUrl = process.env.ARTSY_API_URL!;
  if (!token || !artsyApiUrl) {
    throw new Error("Artsy API token or URL is not defined");
  }

  // Build filter arguments (same as before)
  const filterArgs = Object.entries(params)
    .map(([key, value]) => {
      if (
        value === null ||
        value === undefined ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === "string" && value.trim() === "")
      )
        return null; // Added empty string check
      const graphQLKey = key;
      let graphQLValue;
      if (typeof value === "string") {
        graphQLValue = `"${value.replace(/"/g, '\\"')}"`;
      } else if (typeof value === "boolean") {
        graphQLValue = value;
      } else if (Array.isArray(value)) {
        graphQLValue = `[${value
          .map((v) =>
            typeof v === "string" ? `"${v.replace(/"/g, '\\"')}"` : v
          ) // Ensure strings in arrays are also escaped
          .join(", ")}]`;
      } else {
        graphQLValue = value; // Numbers, etc.
      }
      return `${graphQLKey}: ${graphQLValue}`;
    })
    .filter(Boolean)
    .join(", ");

  // Base GraphQL query structure - Define variables $size and potentially $after
  const queryDefinition = `query SearchArtworks($size: Int${
    after ? ", $after: String" : ""
  })`;
  // Arguments for artworksConnection - Include 'after: $after' if provided
  const connectionArgs = `first: $size, ${filterArgs}${
    after ? ", after: $after" : ""
  }`;

  const graphqlQuery = {
    query: `
      ${queryDefinition} {
        artworksConnection(${connectionArgs}) {
          edges {
            node {
              internalID
              title
              slug
              date
              medium
              artists { name slug }
              image { url(version: "large") aspectRatio }
            }
          }
          pageInfo { # Always fetch pageInfo
            hasNextPage
            endCursor
          }
        }
      }
    `,
    variables: {
      size: 18,
      // Only include 'after' in variables if it has a value
      ...(after && { after: after }),
    },
  };

  console.log("Executing Artsy Query:", graphqlQuery.query);
  console.log("With Variables:", graphqlQuery.variables); // Log variables too

  const response = await fetch(artsyApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-token": token,
      "x-user-id": userId, // Include user ID if required by your Artsy setup
    },
    body: JSON.stringify(graphqlQuery),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Artsy API Error (${response.status}): ${errorBody}`);
    // Try to parse error for more details if possible
    try {
      const errorJson = JSON.parse(errorBody);
      if (errorJson.errors) {
        console.error("Artsy GraphQL Errors:", errorJson.errors);
        throw new Error(`GraphQL errors: ${JSON.stringify(errorJson.errors)}`);
      }
    } catch (e) {
      console.error("Failed to parse Artsy error response:", e);
    }
    throw new Error(
      `Failed to fetch from Artsy: ${response.status} ${response.statusText}`
    );
  }

  const result = await response.json();

  // Check for GraphQL errors returned in the JSON body even with a 200 OK status
  if (result.errors) {
    console.error("Artsy GraphQL Errors:", result.errors);
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  // Check if the expected data structure is present
  if (!result.data || !result.data.artworksConnection) {
    console.warn("Artsy response missing data.artworksConnection:", result);
    // Return a structure indicating no results but include empty pageInfo
    return {
      artworksConnection: {
        edges: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  }

  return result.data;
}

// --- Main API Handler: Modified to accept 'after' cursor ---
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ArtsyApiSuccessData | ErrorResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    // Destructure query and the optional 'after' cursor from the body
    const { query, after } = req.body;

    if (!query || typeof query !== "string" || query.trim() === "") {
      return res.status(400).json({ error: "Invalid or empty query provided" });
    }
    // Validate 'after' cursor if present (basic type check)
    if (after && typeof after !== "string") {
      return res.status(400).json({ error: "Invalid 'after' cursor provided" });
    }

    // Convert natural language query to Artsy parameters using Gemini
    // This happens for both initial search and subsequent 'load more' calls,
    // ensuring the filters remain consistent.
    // A potential optimization could be to cache or pass these params,
    // but this approach is simpler given the current structure.
    const artsyParams = await convertNaturalLanguageToArtsyParams(query);

    // Perform the Artsy query, passing the parameters AND the 'after' cursor (if it exists)
    const artsyData = await queryArtsy(artsyParams, after || null); // Pass null if after is undefined/falsy

    return res.status(200).json(artsyData);
  } catch (error: any) {
    console.error("[API SEARCH HANDLER ERROR]:", error);
    // Ensure a generic error message in production if needed
    return res
      .status(500)
      .json({ error: error.message || "An internal server error occurred" });
  }
}
