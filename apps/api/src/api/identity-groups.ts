import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'
import {
  acceptInvitationResponseSchema,
  addOrgMemberRequestSchema,
  authPrincipalSchema,
  authResponseSchema,
  createInvitationRequestSchema,
  createOrganizationRequestSchema,
  createReviewTokenRequestSchema,
  createRoleRequestSchema,
  addTeamMemberRequestSchema,
  createTeamRequestSchema,
  deleteMeResponseSchema,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  googleAuthCallbackRequestSchema,
  googleAuthStartResponseSchema,
  idsBodySchema,
  invitationSchema,
  invitationsListParamsSchema,
  invitationSummarySchema,
  listParamsSchema,
  listReviewTokensResponseSchema,
  listRolesResponseSchema,
  manyResponseSchema,
  myPermissionsResponseSchema,
  orgMemberSchema,
  orgMembersResponseSchema,
  organizationSchema,
  refreshSessionRequestSchema,
  refreshSessionResponseSchema,
  reviewTokenSchema,
  reviewTokensListParamsSchema,
  reviewTokenValidationSchema,
  roleApiResponseSchema,
  rolePermissionMapSchema,
  rolesListParamsSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  signInRequestSchema,
  signOutAllResponseSchema,
  signOutResponseSchema,
  signUpRequestSchema,
  teamApiResponseSchema,
  teamMemberSchema,
  teamMembersListParamsSchema,
  teamMembersResponseSchema,
  transferOwnershipRequestSchema,
  transferOwnershipResponseSchema,
  updateInvitationRequestSchema,
  updateMemberRoleRequestSchema,
  updateOrganizationRequestSchema,
  updateRoleRequestSchema,
  updateTeamMemberRoleRequestSchema,
  updateTeamRequestSchema,
  listOrganizationsResponseSchema,
  listInvitationsResponseSchema,
  listInvitationSummariesResponseSchema,
  listTeamsResponseSchema,
  teamsListParamsSchema
} from '@tx-agent-kit/contracts'
import * as Schema from 'effect/Schema'
import { DeletedResponse, OrganizationIdParam, TeamIdParam } from './shared-schemas.js'

// --- Aliases referencing contract schemas ---

const AuthResponse = authResponseSchema
const PrincipalResponse = authPrincipalSchema
const DeleteMeResponse = deleteMeResponseSchema

const SignUpBody = signUpRequestSchema
const SignInBody = signInRequestSchema
const ForgotPasswordBody = forgotPasswordRequestSchema
const ForgotPasswordResponse = forgotPasswordResponseSchema
const ResetPasswordBody = resetPasswordRequestSchema
const ResetPasswordResponse = resetPasswordResponseSchema
const RefreshSessionBody = refreshSessionRequestSchema
const RefreshSessionResponse = refreshSessionResponseSchema
const SignOutResponse = signOutResponseSchema
const SignOutAllResponse = signOutAllResponseSchema
const GoogleAuthStartResponse = googleAuthStartResponseSchema
const GoogleAuthCallbackParams = googleAuthCallbackRequestSchema
const GoogleAuthCallbackResponse = authResponseSchema

const Organization = organizationSchema
const OrganizationsResponse = listOrganizationsResponseSchema
const OrganizationsListParams = listParamsSchema
const CreateOrganizationBody = createOrganizationRequestSchema
const UpdateOrganizationBody = updateOrganizationRequestSchema

const OrgMember = orgMemberSchema
const OrgMembersResponse = orgMembersResponseSchema
const OrgMembersListParams = listParamsSchema
const AddOrgMemberBody = addOrgMemberRequestSchema
const UpdateMemberRoleBody = updateMemberRoleRequestSchema
const TransferOwnershipBody = transferOwnershipRequestSchema
const TransferOwnershipResponse = transferOwnershipResponseSchema

const MemberIdParam = HttpApiSchema.param('memberId', Schema.String)

const InvitationSummary = invitationSummarySchema
const Invitation = invitationSchema
const InvitationsResponse = listInvitationsResponseSchema
const InvitationSummariesResponse = listInvitationSummariesResponseSchema
const InvitationsListParams = invitationsListParamsSchema
const CreateInvitationBody = createInvitationRequestSchema
const UpdateInvitationBody = updateInvitationRequestSchema
const AcceptInvitationResponse = acceptInvitationResponseSchema

const InvitationTokenParam = HttpApiSchema.param('token', Schema.String)
const InvitationIdParam = HttpApiSchema.param('invitationId', Schema.String)

const Team = teamApiResponseSchema
const TeamsResponse = listTeamsResponseSchema
const TeamsListParams = teamsListParamsSchema
const CreateTeamBody = createTeamRequestSchema
const UpdateTeamBody = updateTeamRequestSchema

const TeamMember = teamMemberSchema
const TeamMembersResponse = teamMembersResponseSchema
const TeamMembersListParams = teamMembersListParamsSchema
const AddTeamMemberBody = addTeamMemberRequestSchema
const UpdateTeamMemberRoleBody = updateTeamMemberRoleRequestSchema
const TeamMemberIdParam = HttpApiSchema.param('memberId', Schema.String)

const IdsBody = idsBodySchema
const OrganizationsManyResponse = manyResponseSchema(organizationSchema)
const InvitationsManyResponse = manyResponseSchema(invitationSummarySchema)

const PermissionMapResponse = rolePermissionMapSchema
const MyPermissionsResponse = myPermissionsResponseSchema

const ReviewToken = reviewTokenSchema
const ReviewTokensResponse = listReviewTokensResponseSchema
const ReviewTokensListParams = reviewTokensListParamsSchema
const CreateReviewTokenBody = createReviewTokenRequestSchema
const ReviewTokenIdParam = HttpApiSchema.param('tokenId', Schema.String)
const ReviewTokenParam = HttpApiSchema.param('token', Schema.String)
const ReviewTokenValidationResponse = reviewTokenValidationSchema

const RoleResponse = roleApiResponseSchema
const RolesResponse = listRolesResponseSchema
const RolesListParams = rolesListParamsSchema
const CreateRoleBody = createRoleRequestSchema
const UpdateRoleBody = updateRoleRequestSchema
const RoleIdParam = HttpApiSchema.param('roleId', Schema.String)

export const AuthGroup = HttpApiGroup.make('auth')
  .add(HttpApiEndpoint.post('signUp', '/v1/auth/sign-up').setPayload(SignUpBody).addSuccess(AuthResponse, { status: 201 }))
  .add(HttpApiEndpoint.post('signIn', '/v1/auth/sign-in').setPayload(SignInBody).addSuccess(AuthResponse))
  .add(HttpApiEndpoint.post('refreshSession', '/v1/auth/refresh').setPayload(RefreshSessionBody).addSuccess(RefreshSessionResponse))
  .add(HttpApiEndpoint.post('signOut', '/v1/auth/sign-out').addSuccess(SignOutResponse))
  .add(HttpApiEndpoint.post('signOutAll', '/v1/auth/sign-out-all').addSuccess(SignOutAllResponse))
  .add(HttpApiEndpoint.get('googleStart', '/v1/auth/google/start').addSuccess(GoogleAuthStartResponse))
  .add(
    HttpApiEndpoint.get('googleCallback', '/v1/auth/google/callback')
      .setUrlParams(GoogleAuthCallbackParams)
      .addSuccess(GoogleAuthCallbackResponse)
  )
  .add(
    HttpApiEndpoint.post('forgotPassword', '/v1/auth/forgot-password')
      .setPayload(ForgotPasswordBody)
      .addSuccess(ForgotPasswordResponse, { status: 202 })
  )
  .add(
    HttpApiEndpoint.post('resetPassword', '/v1/auth/reset-password')
      .setPayload(ResetPasswordBody)
      .addSuccess(ResetPasswordResponse)
  )
  .add(HttpApiEndpoint.get('me', '/v1/auth/me').addSuccess(PrincipalResponse))
  .add(HttpApiEndpoint.del('deleteMe', '/v1/auth/me').addSuccess(DeleteMeResponse))

export const OrganizationsGroup = HttpApiGroup.make('organizations')
  .add(
    HttpApiEndpoint.get('listOrganizations', '/v1/organizations')
      .setUrlParams(OrganizationsListParams)
      .addSuccess(OrganizationsResponse)
  )
  .add(HttpApiEndpoint.post('createOrganization', '/v1/organizations').setPayload(CreateOrganizationBody).addSuccess(Organization, { status: 201 }))
  .add(
    HttpApiEndpoint.get('getOrganization')`/v1/organizations/${OrganizationIdParam}`
      .addSuccess(Organization)
  )
  .add(
    HttpApiEndpoint.post('getManyOrganizations', '/v1/organizations/batch/get-many')
      .setPayload(IdsBody)
      .addSuccess(OrganizationsManyResponse)
  )
  .add(
    HttpApiEndpoint.patch('updateOrganization')`/v1/organizations/${OrganizationIdParam}`
      .setPayload(UpdateOrganizationBody)
      .addSuccess(Organization)
  )
  .add(
    HttpApiEndpoint.del('removeOrganization')`/v1/organizations/${OrganizationIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.get('listInvitations', '/v1/invitations')
      .setUrlParams(InvitationsListParams)
      .addSuccess(InvitationsResponse)
  )
  .add(
    HttpApiEndpoint.get('getInvitation')`/v1/invitations/${InvitationIdParam}`
      .addSuccess(Invitation)
  )
  .add(
    HttpApiEndpoint.post('getManyInvitations', '/v1/invitations/batch/get-many')
      .setPayload(IdsBody)
      .addSuccess(InvitationsManyResponse)
  )
  .add(HttpApiEndpoint.post('createInvitation', '/v1/invitations').setPayload(CreateInvitationBody).addSuccess(Invitation, { status: 201 }))
  .add(
    HttpApiEndpoint.patch('updateInvitation')`/v1/invitations/${InvitationIdParam}`
      .setPayload(UpdateInvitationBody)
      .addSuccess(InvitationSummary)
  )
  .add(
    HttpApiEndpoint.del('removeInvitation')`/v1/invitations/${InvitationIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(HttpApiEndpoint.post('acceptInvitation')`/v1/invitations/${InvitationTokenParam}/accept`.addSuccess(AcceptInvitationResponse))
  .add(
    HttpApiEndpoint.post('addOrgMember')`/v1/organizations/${OrganizationIdParam}/members`
      .setPayload(AddOrgMemberBody)
      .addSuccess(OrgMember, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get('listOrgMembers')`/v1/organizations/${OrganizationIdParam}/members`
      .setUrlParams(OrgMembersListParams)
      .addSuccess(OrgMembersResponse)
  )
  .add(
    HttpApiEndpoint.get('listOrgInvitations')`/v1/organizations/${OrganizationIdParam}/invitations`
      .setUrlParams(InvitationsListParams)
      .addSuccess(InvitationSummariesResponse)
  )
  .add(
    HttpApiEndpoint.patch('updateMemberRole')`/v1/organizations/${OrganizationIdParam}/members/${MemberIdParam}/role`
      .setPayload(UpdateMemberRoleBody)
      .addSuccess(OrgMember)
  )
  .add(
    HttpApiEndpoint.post('disableMember')`/v1/organizations/${OrganizationIdParam}/members/${MemberIdParam}/disable`
      .addSuccess(OrgMember)
  )
  .add(
    HttpApiEndpoint.post('enableMember')`/v1/organizations/${OrganizationIdParam}/members/${MemberIdParam}/enable`
      .addSuccess(OrgMember)
  )
  .add(
    HttpApiEndpoint.del('removeMember')`/v1/organizations/${OrganizationIdParam}/members/${MemberIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.post('transferOwnership')`/v1/organizations/${OrganizationIdParam}/transfer-ownership`
      .setPayload(TransferOwnershipBody)
      .addSuccess(TransferOwnershipResponse)
  )

export const TeamsGroup = HttpApiGroup.make('teams')
  .add(
    HttpApiEndpoint.get('listTeams', '/v1/teams')
      .setUrlParams(TeamsListParams)
      .addSuccess(TeamsResponse)
  )
  .add(HttpApiEndpoint.post('createTeam', '/v1/teams').setPayload(CreateTeamBody).addSuccess(Team, { status: 201 }))
  .add(
    HttpApiEndpoint.get('getTeam')`/v1/teams/${TeamIdParam}`
      .addSuccess(Team)
  )
  .add(
    HttpApiEndpoint.patch('updateTeam')`/v1/teams/${TeamIdParam}`
      .setPayload(UpdateTeamBody)
      .addSuccess(Team)
  )
  .add(
    HttpApiEndpoint.del('removeTeam')`/v1/teams/${TeamIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.post('createReviewToken')`/v1/teams/${TeamIdParam}/review-tokens`
      .setPayload(CreateReviewTokenBody)
      .addSuccess(ReviewToken, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get('listReviewTokens')`/v1/teams/${TeamIdParam}/review-tokens`
      .setUrlParams(ReviewTokensListParams)
      .addSuccess(ReviewTokensResponse)
  )
  .add(
    HttpApiEndpoint.del('revokeReviewToken')`/v1/teams/${TeamIdParam}/review-tokens/${ReviewTokenIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.get('validateReviewToken')`/v1/review/${ReviewTokenParam}`
      .addSuccess(ReviewTokenValidationResponse)
  )
  .add(
    HttpApiEndpoint.get('listTeamMembers')`/v1/teams/${TeamIdParam}/members`
      .setUrlParams(TeamMembersListParams)
      .addSuccess(TeamMembersResponse)
  )
  .add(
    HttpApiEndpoint.post('addTeamMember')`/v1/teams/${TeamIdParam}/members`
      .setPayload(AddTeamMemberBody)
      .addSuccess(TeamMember, { status: 201 })
  )
  .add(
    HttpApiEndpoint.patch('updateTeamMemberRole')`/v1/teams/${TeamIdParam}/members/${TeamMemberIdParam}/role`
      .setPayload(UpdateTeamMemberRoleBody)
      .addSuccess(TeamMember)
  )
  .add(
    HttpApiEndpoint.del('removeTeamMember')`/v1/teams/${TeamIdParam}/members/${TeamMemberIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.post('disableTeamMember')`/v1/teams/${TeamIdParam}/members/${TeamMemberIdParam}/disable`
      .addSuccess(TeamMember)
  )
  .add(
    HttpApiEndpoint.post('enableTeamMember')`/v1/teams/${TeamIdParam}/members/${TeamMemberIdParam}/enable`
      .addSuccess(TeamMember)
  )

export const PermissionsGroup = HttpApiGroup.make('permissions')
  .add(
    HttpApiEndpoint.get('getPermissionMap', '/v1/permissions')
      .addSuccess(PermissionMapResponse)
  )
  .add(
    HttpApiEndpoint.get('getMyPermissions', '/v1/permissions/me')
      .addSuccess(MyPermissionsResponse)
  )

export const RolesGroup = HttpApiGroup.make('roles')
  .add(
    HttpApiEndpoint.get('listRoles', '/v1/roles')
      .setUrlParams(RolesListParams)
      .addSuccess(RolesResponse)
  )
  .add(
    HttpApiEndpoint.post('createRole', '/v1/roles')
      .setPayload(CreateRoleBody)
      .addSuccess(RoleResponse, { status: 201 })
  )
  .add(
    HttpApiEndpoint.patch('updateRole')`/v1/roles/${RoleIdParam}`
      .setPayload(UpdateRoleBody)
      .addSuccess(RoleResponse)
  )
  .add(
    HttpApiEndpoint.del('removeRole')`/v1/roles/${RoleIdParam}`
      .addSuccess(DeletedResponse)
  )
