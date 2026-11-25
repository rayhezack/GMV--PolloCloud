import type { ReactNode } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
/** <Modal open={open} onOpenChange={setOpen} title="更新记录">...</Modal> */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  actions,
  width = 680,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={width} padding={6}>
      <DialogHeader title={title} subtitle={description} endContent={actions} onOpenChange={onOpenChange} />
      <div className="sys-modal-body">{children}</div>
    </Dialog>
  );
}
