import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Something that deletes for good, waiting for a yes. */
export interface ConfirmRequest {
  readonly title: string;
  readonly description: string;
  /** The red button's label, such as "Delete". */
  readonly action: string;
  readonly run: () => void;
}

/** Asks before deleting what Undo can't bring back. */
export const ConfirmDialog = ({
  onClose,
  request,
}: {
  readonly request: ConfirmRequest | null;
  readonly onClose: () => void;
}) => (
  <AlertDialog
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
    open={request !== null}
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{request?.title}</AlertDialogTitle>
        <AlertDialogDescription>{request?.description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={() => {
            request?.run();
          }}
        >
          {request?.action}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
