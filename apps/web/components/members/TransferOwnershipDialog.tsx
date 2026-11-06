'use client'

import { useState } from 'react'
import { useOrganizationsTransferOwnership } from '@/lib/api/generated/organizations/organizations'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { Member } from './membersLibrary'

export function TransferOwnershipDialog({
  orgId,
  isAdmin,
  members,
  currentUserId,
  transferDialogOpen,
  setTransferDialogOpen,
  invalidateMembers
}: {
  orgId: string
  isAdmin: boolean
  members: Member[]
  currentUserId: string | undefined
  transferDialogOpen: boolean
  setTransferDialogOpen: (open: boolean) => void
  invalidateMembers: () => Promise<void>
}) {
  const transferMutation = useOrganizationsTransferOwnership({
    mutation: {
      onSuccess: () => {
        setTransferDialogOpen(false)
        setNewOwnerUserId('')
        void invalidateMembers()
      },
      onError: (error) => { notify.apiError(error, 'Failed to transfer ownership') }
    }
  })

  const [newOwnerUserId, setNewOwnerUserId] = useState('')
  const eligibleOwners = members.filter(
    (m) => m.userId !== currentUserId && !m.disabledAt && m.role === 'admin'
  )

  return (
    <>
      {isAdmin && (
        <>
          <Dialog
            open={transferDialogOpen}
            onOpenChange={(open: boolean) => {
              if (!open) {
                setTransferDialogOpen(false)
                setNewOwnerUserId('')
              }
            }}
          >
            <DialogContent aria-label="Transfer ownership">
              <DialogHeader>
                <DialogTitle>Transfer Ownership</DialogTitle>
                <DialogDescription>
                  Select a member to transfer organization ownership to. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 py-2">
                <Label htmlFor="new-owner-select">New owner</Label>
                <Select
                  value={newOwnerUserId}
                  onValueChange={(value) => setNewOwnerUserId(value)}
                >
                  <SelectTrigger id="new-owner-select" aria-label="New owner">
                    <SelectValue>{newOwnerUserId ? undefined : 'Select a member'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleOwners.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.userName ?? m.userEmail ?? m.userId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setTransferDialogOpen(false)
                    setNewOwnerUserId('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => transferMutation.mutate({
                    organizationId: orgId,
                    data: { newOwnerUserId }
                  })}
                  disabled={!newOwnerUserId || transferMutation.isPending}
                >
                  {transferMutation.isPending ? 'Transferring...' : 'Confirm Transfer'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  )
}
