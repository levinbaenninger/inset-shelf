import type { QuitAnswer, QuitPrompt } from "@shared/contracts";
import { useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const title = (count: number): string =>
  count === 1
    ? "1 change couldn't be saved"
    : `${count} changes couldn't be saved`;

/**
 * A quit held because the disk doesn't hold every change. Return retries
 * and Esc cancels, whichever button has focus. While a Retry runs, main
 * ignores the answers, so the buttons stay where they are.
 */
export const QuitPromptDialog = ({
  onAnswer,
  prompt,
}: {
  readonly prompt: QuitPrompt | null;
  readonly onAnswer: (answer: QuitAnswer) => void;
}) => {
  const retryRef = useRef<HTMLButtonElement>(null);
  // The words stay while the prompt fades out after an answer.
  const [shown, setShown] = useState(prompt);

  if (prompt !== null && prompt !== shown) {
    setShown(prompt);
  }

  const retrying = prompt?.state === "retrying";

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onAnswer("cancel");
        }
      }}
      open={prompt !== null}
    >
      <AlertDialogContent
        className="w-[calc(100%-2rem)]"
        onKeyDown={(event) => {
          // The list behind the prompt keeps its keys to itself.
          event.stopPropagation();

          if (event.key === "Enter") {
            event.preventDefault();
            onAnswer("retry");
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          retryRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title(shown?.count ?? 1)}</AlertDialogTitle>
          <AlertDialogDescription>
            {shown?.state === "stillFailing"
              ? `Still not saved. ${shown.message}`
              : shown?.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Button
            onClick={() => {
              onAnswer("retry");
            }}
            ref={retryRef}
          >
            {retrying ? "Retrying…" : "Retry"}
          </Button>
          <Button
            onClick={() => {
              onAnswer("discard");
            }}
            variant="destructive"
          >
            Quit without saving
          </Button>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
