// /pages/api/sanity-webhook.ts (Next.js API route)
import type { NextApiRequest, NextApiResponse } from "next";
import algoliasearch from "algoliasearch";
import { createClient } from "@sanity/client";

const sanity = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
  apiVersion: "2023-05-01",
  useCdn: false,
  token: process.env.SANITY_API_READ_TOKEN!,
});

const algolia = algoliasearch(
  process.env.NEXT_PUBLIC_ALGOLIA_APP_ID!,
  process.env.ALGOLIA_ADMIN_KEY!,
);
const index = algolia.initIndex("blogs_with_relations");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { _id, _type, event } = req.body;

    if (_type !== "blog") {
      return res.status(200).json({ message: "Ignored non-blog doc" });
    }

    if (event === "delete") {
      await index.deleteObject(_id);
      return res.status(200).json({ message: `Deleted blog ${_id}` });
    }

    // 👇 fetch full blog with relations like indexToAlgolia
    const blog = await sanity.fetch(
      `*[_type == "blog" && _id == $id][0]{
        _id,
        title,
        "slug": slug.current,
        excerpt,
        publishedAt,
        categories[]->{
          _id,
          title,
          "slug": slug.current,
          description,
          seo
        },
        featuredPokemon->{
          id,
          name,
          sprite,
          types
        }
      }`,
      { id: _id },
    );

    if (!blog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    // 👇 shape exactly like indexToAlgolia
    const mappedDoc = {
      objectID: blog._id,
      title: blog.title,
      slug: `/${blog.slug}`,
      excerpt: blog.excerpt,
      publishedAt: blog.publishedAt,
      categories: blog.categories || [],
      featuredPokemon: blog.featuredPokemon || null,
    };

    await index.saveObject(mappedDoc);

    return res.status(200).json({ message: "Indexed blog", blog: mappedDoc });
  } catch (error: any) {
    console.error("Webhook error:", error);
    return res
      .status(500)
      .json({ message: "Error handling webhook", error: error.message });
  }
}
