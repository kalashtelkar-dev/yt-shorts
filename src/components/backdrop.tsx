import { getImageProps } from "next/image";
import desktop from "../../public/images/montage-bg.jpg";
import mobile from "../../public/images/montage-bg-mobile.jpg";

// The ambient artwork behind every user page (design B, the user's call on 2026-10-01): fixed behind the content,
// under a near-black veil whose strength each page picks with data-backdrop (globals.css, .backdrop).
// Lazy and low priority, so it never competes with the page's own content for LCP; phones get the portrait crop.
export function Backdrop() {
  const common = { alt: "", sizes: "100vw", quality: 60, loading: "lazy", fetchPriority: "low" } as const;
  const { srcSet: wide } = getImageProps({ ...common, src: desktop }).props;
  const { props } = getImageProps({ ...common, src: mobile });
  return (
    <div aria-hidden className="backdrop print:hidden">
      <picture>
        <source media="(min-width: 640px)" srcSet={wide} />
        <img {...props} alt="" />
      </picture>
    </div>
  );
}
