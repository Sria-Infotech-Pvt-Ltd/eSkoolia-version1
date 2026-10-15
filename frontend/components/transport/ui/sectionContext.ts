"use client";
/**
 * Set when a Transport screen is rendered as one section of a combined page
 * (see sections.tsx). TransportPage, PageHero and useDeepLink read it so an
 * existing screen can be stacked under another without a second page frame,
 * a second <h1>, or both sections reacting to the same ?id= / ?new= link.
 */
import { createContext, useContext } from "react";

export interface TransportSectionInfo {
  /** Section key; also the element id and the `?section=` value that targets it. */
  key: string;
  /** The first section owns un-targeted deep links (no `?section=`). */
  primary: boolean;
}

export const TransportSectionContext = createContext<TransportSectionInfo | null>(null);

export function useTransportSection(): TransportSectionInfo | null {
  return useContext(TransportSectionContext);
}
