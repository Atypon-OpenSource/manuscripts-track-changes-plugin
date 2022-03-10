/*!
 * © 2021 Atypon Systems LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
export enum CHANGE_OPERATION {
  insert = 'insert',
  delete = 'delete',
  update = 'update',
}
export enum CHANGE_STATUS {
  accepted = 'accepted',
  rejected = 'rejected',
  pending = 'pending',
}
export interface TrackedAttrs {
  id: string
  userID: string
  userName: string
  operation: CHANGE_OPERATION
  status: CHANGE_STATUS
  time: number
}
export type Change = {
  id: string
  from: number
  to: number
  attrs: TrackedAttrs
}
export type TextChange = Change & {
  type: 'text-change'
}
export type NodeChange = Change & {
  type: 'node-change'
  nodeType: string
  mergeInsteadOfDelete: boolean
  children: TrackedChange[]
}
export type IncompleteTextChange = Omit<TextChange, 'attrs'> & {
  attrs: Partial<TrackedAttrs>
}
export type IncompleteNodeChange = Omit<NodeChange, 'attrs'> & {
  attrs: Partial<TrackedAttrs>
}
export type TrackedChange = TextChange | NodeChange
export type PartialTrackedChange =
  | TextChange
  | NodeChange
  | IncompleteTextChange
  | IncompleteNodeChange

export interface TreeNode {
  change: PartialTrackedChange
  children: PartialTrackedChange[]
}
