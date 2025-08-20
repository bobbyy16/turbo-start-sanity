import type { QueryBlogIndexPageDataResult } from "@/lib/sanity/sanity.types";

export type Blog = NonNullable<
  NonNullable<QueryBlogIndexPageDataResult>["blogs"]
>[number];

export interface Category {
  _id: string;
  title: string;
  slug: string;
}
