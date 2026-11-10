// The record's name, with the display field's avatar in front when it has one.
import type { ReactNode } from "react";

import { avatarSrc, titleOf } from "../lib/records.ts";
import type { ObjectDescription } from "../lib/records.ts";

/** The image that leads a display value. The name beside it is the label. */
export const RecordAvatar = ({ src }: { src: string }) => (
  <img
    alt=""
    src={src}
    className="size-5 shrink-0 rounded-full bg-muted object-cover"
  />
);

/** `children`, with an avatar in front when `src` is a picture. */
export const WithAvatar = ({
  src,
  children,
}: {
  src: string | null;
  children: ReactNode;
}) =>
  src ? (
    <span className="inline-flex min-w-0 items-center gap-2">
      <RecordAvatar src={src} />
      <span className="truncate">{children}</span>
    </span>
  ) : (
    children
  );

/** A record's name, led by its avatar when the display field names one. */
export const RecordTitle = ({
  record,
  object,
  title,
  empty = "",
}: {
  record: Record<string, unknown> | undefined;
  object: ObjectDescription | undefined;
  /** The words to show. Omit it to use the record's display field. */
  title?: string;
  empty?: string;
}) => {
  const src = avatarSrc(record, object);
  const text = title ?? (titleOf(record, object) || empty);
  return <WithAvatar src={src}>{text}</WithAvatar>;
};
