"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog, where "Save as PDF" is one of the printers. */
export function PrintButton() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer aria-hidden /> Print or save as PDF
    </Button>
  );
}
