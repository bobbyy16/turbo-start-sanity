// app/api/webhook/sanity/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@sanity/client";
import { algoliasearch } from "algoliasearch";

const sanityClient = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
  token: process.env.SANITY_API_READ_TOKEN!,
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION!,
  useCdn: false,
});

const algolia = algoliasearch(
  process.env.NEXT_PUBLIC_ALGOLIA_APP_ID!,
  process.env.ALGOLIA_ADMIN_API_KEY!,
);

const indexName = "blogs_with_relations";

// Helper: fetch one blog from Sanity
async function fetchBlog(id: string) {
  return sanityClient.fetch(
    `
    *[_type == "blog" && _id == $id][0]{
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
        pokemon {
          id,
          name,
          sprite,
          types
        }
      }
    }
  `,
    { id },
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { _id, _type, _deleted } = body;

    // 🚫 Skip drafts
    if (_id.startsWith("drafts.")) {
      return NextResponse.json(
        { message: "Skipping draft document" },
        { status: 200 },
      );
    }

    if (_type !== "blog") {
      return NextResponse.json(
        { message: "Not a blog update" },
        { status: 200 },
      );
    }

    if (_deleted) {
      // 🗑️ Remove from Algolia
      await algolia.deleteObject({ indexName, objectID: _id });
      return NextResponse.json(
        { message: "Blog deleted from Algolia" },
        { status: 200 },
      );
    }

    const blog = await fetchBlog(_id);

    if (!blog) {
      return NextResponse.json(
        { message: "Blog not found in Sanity" },
        { status: 404 },
      );
    }

    const blogObject = {
      objectID: blog._id,
      title: blog.title,
      slug: blog.slug,
      excerpt: blog.excerpt,
      publishedAt: blog.publishedAt,
      categories: blog.categories?.map((c: any) => ({
        id: c._id,
        title: c.title,
        slug: c.slug,
        description: c.description,
        seo: c.seo,
      })),
      featuredPokemon: blog.featuredPokemon?.pokemon
        ? {
            id: blog.featuredPokemon.pokemon.id ?? null,
            name: blog.featuredPokemon.pokemon.name ?? null,
            sprite: blog.featuredPokemon.pokemon.sprite ?? null,
            types: blog.featuredPokemon.pokemon.types ?? null,
          }
        : { id: null, name: null, sprite: null, types: null },
    };

    // 🚀 Save/update in Algolia
    await algolia.saveObjects({
      indexName,
      objects: [blogObject],
    });

    return NextResponse.json(
      { message: "Blog synced to Algolia", blog: blogObject },
      { status: 200 },
    );
  } catch (error) {
    console.error("❌ Webhook error:", error);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 },
    );
  }
}
