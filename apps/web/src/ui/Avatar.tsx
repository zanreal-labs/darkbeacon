'use client';

import { useState } from 'react';
import styles from './display.module.css';

/** EVE character portrait from the image server; sizes are powers of two from 32 to 1024. */
export function characterPortraitUrl(characterId: number, size: 32 | 64 | 128 | 256 = 64): string {
  return `https://images.evetech.net/characters/${characterId}/portrait?size=${size}`;
}

export function corporationLogoUrl(corporationId: number, size: 32 | 64 | 128 = 64): string {
  return `https://images.evetech.net/corporations/${corporationId}/logo?size=${size}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export interface AvatarProps {
  /** Image URL; initials of `name` are shown without one or when it fails to load. */
  src?: string | null;
  name: string;
  size?: number;
  shape?: 'circle' | 'rounded';
  /** Decorative when a name is shown next to it (default); otherwise the name becomes alt text. */
  decorative?: boolean;
}

/** Discord avatar, EVE portrait or initials. */
export function Avatar({ src, name, size = 28, shape = 'circle', decorative = true }: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!src && failed !== src;
  return (
    <span
      className={styles.avatar}
      data-shape={shape}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      {showImage ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** An EVE character's portrait, at twice the shown size for sharp screens. */
export function CharacterAvatar({
  id,
  name,
  size = 28,
  decorative,
}: {
  id: number;
  name: string;
  size?: number;
  decorative?: boolean;
}) {
  const px = size <= 16 ? 32 : size <= 32 ? 64 : size <= 64 ? 128 : 256;
  return (
    <Avatar
      src={characterPortraitUrl(id, px)}
      name={name}
      size={size}
      shape="rounded"
      decorative={decorative}
    />
  );
}
