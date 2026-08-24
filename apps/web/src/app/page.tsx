import { FeedExperience } from "@/features/feed/feed-experience";
import { creatorSubmissionsEnabled } from "@/lib/server/feature-flags";

export default function Home() {
  return <FeedExperience creationEnabled={creatorSubmissionsEnabled()} />;
}
