import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleGenerativeAI, SchemaType, Tool } from "@google/generative-ai";

interface ArtsyApiSuccessData {
  artworksConnection?: {
    edges: any[];
    pageInfo: any;
  } | null;
}

interface ErrorResponse {
  error: string;
}
async function convertNaturalLanguageToArtsyParams(
  query: string
): Promise<Record<string, any>> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("API key is not defined");
  }
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: "gemini-2.0-flash-lite",
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
            // Match these properties closely with Artsy's artworksConnection filter arguments
            artistIDs: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
              description:
                "Array of Artsy artist slugs or IDs (e.g., ['pablo-picasso', 'andy-warhol']). Extract slugs if names are mentioned.",
            },
            keyword: {
              type: SchemaType.STRING,
              description:
                "General keyword search term (searches title, artist names, medium, etc.). Use if specific fields aren't identified or as a fallback.",
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
            // Add other relevant Artsy parameters based on their schema and common user queries
            // See: https://metaphysics-production.artsy.net/ (use introspection tool like GraphiQL)
          },
          // Adjust required field(s) based on typical queries. Keyword is a safe fallback.
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

      const cleanedArgs: Record<string, any> = {};
      for (const key in args) {
        if (Object.prototype.hasOwnProperty.call(args, key)) {
          const value = (args as Record<string, any>)[key];
          if (value !== undefined && value !== null) {
            if (Array.isArray(value) && value.length === 0) {
              continue; // Skip empty arrays
            }
            cleanedArgs[key] = value;
          }
        }
      }

      // Ensure there's at least a keyword if other fields are empty or don't make sense alone
      if (
        Object.keys(cleanedArgs).length === 0 ||
        !Object.values(cleanedArgs).some((v) => v)
      ) {
        console.warn(
          "Gemini returned empty or null args, falling back to keyword."
        );
        return { keyword: query };
      }
      // Ensure keyword exists if it's required or makes sense as a fallback
      if (
        !cleanedArgs.keyword &&
        artsySearchTool.functionDeclarations?.[0]?.parameters?.required?.includes(
          "keyword"
        )
      ) {
        if (!cleanedArgs.artistIDs && !cleanedArgs.medium) {
          // Add more conditions if other single fields are valid searches
          console.log(
            "Adding query as keyword fallback since specific fields are missing."
          );
          cleanedArgs.keyword = query;
        }
      }

      return cleanedArgs;
    } else {
      console.warn("Gemini did not return expected function call.");
      return { keyword: query };
    }
  } catch (error) {
    console.error("Error during chat:", error);
    return { keyword: query };
  }
}

async function queryArtsy(params: Record<string, any>): Promise<any> {
  const token = process.env.ARTSY_ACCESS_TOKEN!;
  const userId = process.env.ARTSY_USER_ID!;
  const artsyApiUrl = process.env.ARTSY_API_URL!;
  if (!token || !artsyApiUrl) {
    throw new Error("Artsy API token or URL is not defined");
  }

  const filterArgs = Object.entries(params)
    .map(([key, value]) => {
      if (
        value === null ||
        value === undefined ||
        (Array.isArray(value) && value.length === 0)
      )
        return null;
      const graphQLKey = key;
      let graphQLValue;
      if (typeof value === "string") {
        graphQLValue = `"${value.replace(/"/g, '\\"')}"`;
      } else if (typeof value === "boolean") {
        graphQLValue = value;
      } else if (Array.isArray(value)) {
        graphQLValue = `[${value
          .map((v) => (typeof v === "string" ? `"${v}"` : v))
          .join(", ")}]`;
      } else {
        graphQLValue = value;
      }
      return `${graphQLKey}: ${graphQLValue}`;
    })
    .filter(Boolean)
    .join(", ");

  const graphqlQuery = {
    query: ` query SearchArtworks($size: Int) { artworksConnection(first: $size, ${filterArgs}) { edges { node { internalID title slug date medium artists { name slug } image { url(version: "large") aspectRatio } } } pageInfo { hasNextPage endCursor } } } `,
    variables: { size: 20 },
  };

  console.log("Executing Artsy Query:", graphqlQuery.query);

  const response = await fetch(artsyApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-token": token,
      "x-user-id": userId,
    },
    body: JSON.stringify(graphqlQuery),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Artsy API Error (${response.status}): ${errorBody}`);
    throw new Error(`Failed to fetch from Artsy: ${response.statusText}`);
  }
  const result = await response.json();

  if (result.errors) {
    console.error("Artsy GraphQL Errors:", result.errors);
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }
  return result.data;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ArtsyApiSuccessData | ErrorResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { query } = req.body;

    if (!query || typeof query !== "string" || query.trim() === "") {
      return res.status(400).json({ error: "Invalid or empty query provided" });
    }

    const artsyParams = await convertNaturalLanguageToArtsyParams(query);
    const artsyData = await queryArtsy(artsyParams);

    return res.status(200).json(artsyData);
  } catch (error: any) {
    console.error("[API CHAT HANDLER ERROR]:", error);
    return res
      .status(500)
      .json({ error: error.message || "An internal server error occurred" });
  }
}
