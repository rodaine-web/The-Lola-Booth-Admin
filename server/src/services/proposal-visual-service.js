import { z } from "zod";
import { query } from "../db/pool.js";
import { getStorageProvider } from "./storage-service.js";
import { AppError } from "../utils/errors.js";
export const proposalVisualSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      title: z.string().trim().min(1).max(100),
      body: z.string().max(3000).default(""),
      kind: z.enum([
        "EXPERIENCE",
        "BOOTH",
        "BACKDROP",
        "OVERLAY",
        "WELCOME_SCREEN",
        "GALLERY_BRANDING",
        "CLIENT_LOGO",
        "REFERENCE",
        "BRAND_ACTIVATION",
        "TIMELINE",
      ]),
      media_ids: z.array(z.string().uuid()).max(4).default([]),
    }),
  )
  .max(16);
export async function validateProposalVisuals(sections = []) {
  const validated = proposalVisualSchema.parse(sections);
  const ids = [...new Set(validated.flatMap((s) => s.media_ids))];
  if (ids.length) {
    const media = await query(
      "SELECT id FROM media_library WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL AND visibility<>'ARCHIVED' AND permission_state='APPROVED' AND mime_type IN('image/jpeg','image/png')",
      [ids],
    );
    if (media.rows.length !== ids.length)
      throw new AppError(
        "Choose approved JPG or PNG assets from the media library.",
        422,
        "PROPOSAL_VISUAL_ASSET_INVALID",
      );
  }
  return validated;
}
export async function hydrateProposalVisuals(proposal) {
  const sections = proposal.visual_sections || [];
  if (!sections.length) return proposal;
  const ids = [...new Set(sections.flatMap((s) => s.media_ids || []))];
  const rows = ids.length
    ? (
        await query(
          "SELECT id,mime_type,storage_key,alt_text FROM media_library WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL AND visibility<>'ARCHIVED' AND permission_state='APPROVED' AND mime_type IN('image/jpeg','image/png')",
          [ids],
        )
      ).rows
    : [];
  const images = new Map();
  for (const row of rows) {
    try {
      const buffer = await getStorageProvider().get(row.storage_key);
      if (buffer.length > 10 * 1024 * 1024) continue;
      images.set(row.id, {
        dataUri: `data:${row.mime_type};base64,${buffer.toString("base64")}`,
        alt: row.alt_text || "Experience preview",
      });
    } catch {
      /* A removed asset must not reveal a path or break the commercial proposal. */
    }
  }
  return {
    ...proposal,
    visual_sections: sections.map((s) => ({
      ...s,
      images: (s.media_ids || []).map((id) => images.get(id)).filter(Boolean),
    })),
  };
}
export const escapeVisual = (value) =>
  String(value || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function proposalVisualHtml(proposal) {
  return (proposal.visual_sections || [])
    .map(
      (s) =>
        `<section class="section visual-experience"><p class="eyebrow">YOUR LOLA EXPERIENCE</p><h2>${escapeVisual(s.title)}</h2>${s.body ? `<p style="white-space:pre-line">${escapeVisual(s.body)}</p>` : ""}<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px">${(s.images || []).map((img) => `<figure style="margin:0;border:1px solid #E8DDD0;padding:10px"><img style="width:100%;height:220px;object-fit:contain" src="${img.dataUri}" alt="${escapeVisual(img.alt)}"></figure>`).join("")}</div></section>`,
    )
    .join("");
}
