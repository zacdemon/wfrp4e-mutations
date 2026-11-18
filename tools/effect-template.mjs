// Shared ActiveEffect source template for effects the pack tools add to mutation items.
import crypto from "node:crypto";

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const stableId = (seed) => [...crypto.createHash("sha256").update(seed).digest()].slice(0, 16).map(b => ALPHA[b % ALPHA.length]).join("");

export function effectSource({ item, id, name, img, scriptData = [], changes = [], flags = {}, disabled = false }) {
  return {
    name, img: img ?? item.img, _id: id, type: "base",
    system: {
      transferData: {
        type: "document", originalType: "document", documentType: "Actor",
        avoidTest: { value: "none", opposed: false, prevention: true, reversed: false },
        testIndependent: false, equipTransfer: false, selfOnly: false, prompt: false,
        area: { templateData: { borderColor: null, fillColor: null, texture: null }, keep: false, aura: { transferred: false, render: false }, duration: "sustained" },
        zone: { type: "zone", transferred: false, traits: {}, skipImmediateOnPlacement: false, keep: false }
      },
      itemTargetData: { ids: [], allItems: false },
      scriptData,
      zone: { type: "zone", traits: {}, skipImmediateOnPlacement: false },
      sourceData: { test: {} }, condition: { value: null, numbered: false }, changes
    },
    disabled,
    duration: { value: null, units: "seconds", expiry: null, expired: false },
    description: "", origin: null, tint: "#ffffff", transfer: true, statuses: [], sort: 0,
    flags: { wfrp4e: { manualEffectKeys: false }, ...flags },
    _stats: { compendiumSource: null, duplicateSource: null, exportSource: null, coreVersion: "14.360", systemId: "wfrp4e", systemVersion: "10.1.2", createdTime: null, modifiedTime: null, lastModifiedBy: null },
    start: null, showIcon: 1, folder: null,
    _key: `!items.effects!${item._id}.${id}`
  };
}
