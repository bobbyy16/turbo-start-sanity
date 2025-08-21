import { NextRequest, NextResponse } from "next/server";
import { algoliasearch } from "algoliasearch";
import { createClient } from "@sanity/client";

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

const recentlyProcessed = new Map<string, number>();

// Helper function to fetch and format blog data
async function fetchAndFormatBlog(documentId: string) {
  const post = await sanityClient.fetch(
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
        pokemon {
          id,
          name,
          sprite,
          types
        }
      }
    }`,
    { id: documentId },
  );

  if (!post || !post.publishedAt) {
    return null;
  }

  return {
    objectID: post._id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    publishedAt: post.publishedAt,
    categories:
      post.categories?.map((c: any) => ({
        id: c._id,
        title: c.title,
        slug: c.slug,
        description: c.description,
        seo: c.seo,
      })) || [],
    featuredPokemon: post.featuredPokemon?.pokemon
      ? {
          id: post.featuredPokemon.pokemon.id ?? null,
          name: post.featuredPokemon.pokemon.name ?? null,
          sprite: post.featuredPokemon.pokemon.sprite ?? null,
          types: post.featuredPokemon.pokemon.types ?? null,
        }
      : { id: null, name: null, sprite: null, types: null },
  };
}

// Helper function to update blogs that reference a changed category
async function updateBlogsWithCategory(categoryId: string) {
  const blogsWithCategory = await sanityClient.fetch(
    `*[_type == "blog" && references($categoryId) && defined(publishedAt)]{_id}`,
    { categoryId },
  );

  for (const blog of blogsWithCategory) {
    const blogData = await fetchAndFormatBlog(blog._id);
    if (blogData) {
      await algolia.saveObjects({
        indexName: "blogs_with_relations",
        objects: [blogData],
      });
    }
  }

  return blogsWithCategory.length;
}

// Helper function to update blogs that reference a changed Pokemon
async function updateBlogsWithPokemon(pokemonId: string) {
  const blogsWithPokemon = await sanityClient.fetch(
    `*[_type == "blog" && featuredPokemon._ref == $pokemonId && defined(publishedAt)]{_id}`,
    { pokemonId },
  );

  for (const blog of blogsWithPokemon) {
    const blogData = await fetchAndFormatBlog(blog._id);
    if (blogData) {
      await algolia.saveObjects({
        indexName: "blogs_with_relations",
        objects: [blogData],
      });
    }
  }

  return blogsWithPokemon.length;
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const documentId = payload._id;
    const documentType = payload._type;
    const operation = payload._rev ? "update" : "create"; // Sanity sends _rev for updates

    console.log(
      `🔄 Processing ${operation} for ${documentType}: ${documentId}`,
    );

    // Deduplication logic
    const now = Date.now();
    const cacheKey = `${documentId}-${operation}`;
    if (recentlyProcessed.has(cacheKey)) {
      const lastProcessed = recentlyProcessed.get(cacheKey)!;
      if (now - lastProcessed < 10000) {
        // 10 second window
        console.log("⏭️ Duplicate skipped");
        return NextResponse.json({ message: "Duplicate skipped" });
      }
    }
    recentlyProcessed.set(cacheKey, now);

    // ===== BLOG OPERATIONS =====
    if (documentType === "blog") {
      const blogData = await fetchAndFormatBlog(documentId);

      if (!blogData) {
        // Blog doesn't exist or is unpublished - remove from index
        await algolia.deleteObject({
          indexName: "blogs_with_relations",
          objectID: documentId,
        });
        console.log("🗑️ Blog removed from index");
        return NextResponse.json({
          message: "Blog removed from index",
          operation: "delete",
        });
      }

      // Blog exists and is published - add/update in index
      await algolia.saveObjects({
        indexName: "blogs_with_relations",
        objects: [blogData],
      });

      console.log("✅ Blog indexed successfully");
      return NextResponse.json({
        message: "Blog indexed successfully",
        operation: operation,
      });
    }

    // ===== CATEGORY OPERATIONS =====
    if (documentType === "category") {
      const category = await sanityClient.fetch(
        `*[_type == "category" && _id == $id][0]{
          _id,
          title,
          "slug": slug.current,
          description,
          seo
        }`,
        { id: documentId },
      );

      if (!category) {
        // Category deleted - update all blogs that referenced it
        const updatedBlogsCount = await updateBlogsWithCategory(documentId);
        console.log(
          `🔄 Updated ${updatedBlogsCount} blogs after category deletion`,
        );

        return NextResponse.json({
          message: `Category deleted, updated ${updatedBlogsCount} blogs`,
          operation: "delete",
        });
      }

      // Category exists - update all blogs that reference it
      const updatedBlogsCount = await updateBlogsWithCategory(documentId);
      console.log(
        `🔄 Updated ${updatedBlogsCount} blogs after category ${operation}`,
      );

      return NextResponse.json({
        message: `Category ${operation}d, updated ${updatedBlogsCount} blogs`,
        operation: operation,
      });
    }

    // ===== POKEDEX OPERATIONS =====
    if (documentType === "pokedex") {
      const pokemon = await sanityClient.fetch(
        `*[_type == "pokedex" && _id == $id][0]{
          _id,
          pokemon {
            id,
            name,
            sprite,
            types
          }
        }`,
        { id: documentId },
      );

      if (!pokemon || !pokemon.pokemon?.id) {
        // Pokemon deleted - update all blogs that referenced it
        const updatedBlogsCount = await updateBlogsWithPokemon(documentId);
        console.log(
          `🔄 Updated ${updatedBlogsCount} blogs after Pokemon deletion`,
        );

        return NextResponse.json({
          message: `Pokemon deleted, updated ${updatedBlogsCount} blogs`,
          operation: "delete",
        });
      }

      // Pokemon exists - update all blogs that reference it
      const updatedBlogsCount = await updateBlogsWithPokemon(documentId);
      console.log(
        `🔄 Updated ${updatedBlogsCount} blogs after Pokemon ${operation}`,
      );

      return NextResponse.json({
        message: `Pokemon ${operation}d, updated ${updatedBlogsCount} blogs`,
        operation: operation,
      });
    }

    console.log("⏭️ Document type not handled");
    return NextResponse.json({
      message: "Document type not handled",
      documentType: documentType,
    });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    return NextResponse.json(
      {
        error: "Webhook processing failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

// Handle DELETE requests (if Sanity sends them separately)
export async function DELETE(request: NextRequest) {
  try {
    const payload = await request.json();
    const documentId = payload._id;
    const documentType = payload._type;

    console.log(`🗑️ Processing DELETE for ${documentType}: ${documentId}`);

    if (documentType === "blog") {
      await algolia.deleteObject({
        indexName: "blogs_with_relations",
        objectID: documentId,
      });

      return NextResponse.json({
        message: "Blog deleted from index",
        operation: "delete",
      });
    }

    if (documentType === "category") {
      const updatedBlogsCount = await updateBlogsWithCategory(documentId);
      return NextResponse.json({
        message: `Category deleted, updated ${updatedBlogsCount} blogs`,
        operation: "delete",
      });
    }

    if (documentType === "pokedex") {
      const updatedBlogsCount = await updateBlogsWithPokemon(documentId);
      return NextResponse.json({
        message: `Pokemon deleted, updated ${updatedBlogsCount} blogs`,
        operation: "delete",
      });
    }

    return NextResponse.json({
      message: "Document type not handled for deletion",
      documentType: documentType,
    });
  } catch (error) {
    console.error("❌ Delete webhook error:", error);
    return NextResponse.json(
      {
        error: "Delete webhook processing failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: "Unified Algolia webhook endpoint working",
    supportedOperations: ["POST (create/update)", "DELETE"],
    supportedTypes: ["blog", "category", "pokedex"],
  });
}
