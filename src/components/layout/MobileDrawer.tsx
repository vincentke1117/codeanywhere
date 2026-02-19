"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right" | "bottom";
  children: React.ReactNode;
}

export function MobileDrawer({
  open,
  onClose,
  side = "left",
  children,
}: MobileDrawerProps) {
  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const slideDirection = {
    left: { initial: { x: "-100%" }, animate: { x: 0 }, exit: { x: "-100%" } },
    right: { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%" } },
    bottom: { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" } },
  }[side];

  const positionClass = {
    left: "inset-y-0 left-0 w-80 max-w-[85vw]",
    right: "inset-y-0 right-0 w-80 max-w-[85vw]",
    bottom: "inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl",
  }[side];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Drawer */}
          <motion.div
            className={`fixed z-50 bg-background shadow-xl ${positionClass}`}
            initial={slideDirection.initial}
            animate={slideDirection.animate}
            exit={slideDirection.exit}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
