export type PublishedItem = {
  id: string;
  network: string;
  contentType: string;
  title?: string | null;
  permalinkUrl?: string | null;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  postedAt?: string | null;
  views?: number | null;
  likes?: number | null;
};
