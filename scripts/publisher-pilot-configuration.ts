/**
 * Deterministic development fixture for configuring the first publisher Agent.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import isEqual from 'lodash/isEqual.js';
import type {
  PostgresDatabase,
} from '../apps/server/src/infrastructure/postgres/database.js';
import {
  postgresAgentJobPublishingPreferences as publishingPreferences,
  postgresAgentJobPublishingTopics as publishingTopics,
  postgresAgentJobs as agentJobs,
  postgresAgents as agents,
  postgresNetworkProfiles as profiles,
  postgresUsers as users,
} from '../apps/server/src/lucid/persistence/postgres/schema.js';
import {
  LUCID_WORKSPACE_ID,
} from '../apps/server/src/lucid/workspace/workspace-identity.js';

const PUBLISHER_PILOT_ID = 'publisher-01-mina-regional-fashion';
const PILOT_USER_ID = 'fixture-user-mina-chen';
const PILOT_AGENT_ID = 'fixture-agent-mina-chen';
const PILOT_PROFILE_ID = 'mina-chen';
const PILOT_REGISTRATION_KEY = 'fixture:post-01:mina-chen';
const PILOT_CONFIGURED_AT = '2026-09-04T00:00:00.000Z';
const PILOT_TOPICS = [
  'Independent fashion',
  'Repairable clothing',
  'Textiles',
] as const;

const PILOT_JOB = {
  id: PUBLISHER_PILOT_ID,
  workspaceId: LUCID_WORKSPACE_ID,
  agentId: PILOT_AGENT_ID,
  kind: 'information-network-publishing',
  name: 'Regional fashion publisher',
  instructions:
    'Research one current development in East Asian independent fashion, repair culture, or practical textile design. Publish only when the sources support a useful, self-contained update.',
  cadenceMs: 10_800_000,
  enabled: true,
  scheduleMode: 'manual',
  createdAt: PILOT_CONFIGURED_AT,
  updatedAt: PILOT_CONFIGURED_AT,
} as const;

const PILOT_PREFERENCES = {
  agentJobId: PUBLISHER_PILOT_ID,
  region: 'Taiwan and East Asia',
  intendedAudience:
    'People interested in practical, repairable, independently made clothing',
  tone: 'Concise, curious, and evidence-led',
  sourceGuidance:
    'Prefer primary sources and reputable regional reporting. Preserve every source URL used, and publish nothing when the evidence is weak.',
  createdAt: PILOT_CONFIGURED_AT,
  updatedAt: PILOT_CONFIGURED_AT,
} as const;

export type PublisherPilotConfigurationReceipt = {
  pilotId: string;
  profileId: string;
  agentJobId: string;
  scheduleMode: 'manual';
  cadenceMs: number;
};

/**
 * Activates Mina's fixture identity and configures one manual publishing job.
 * Nothing runs here: the Coordinator still needs Lucid admission plus an
 * explicit run request before the Runtime receives any model authority.
 */
export class PostgresPublisherPilotConfigurator {
  constructor(private readonly database: PostgresDatabase) {}

  async configure(): Promise<PublisherPilotConfigurationReceipt> {
    return await this.database.orm.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${PUBLISHER_PILOT_ID}))`,
      );
      const [[user], [agent], [profile]] = await Promise.all([
        transaction.select({
          id: users.id,
          workspaceId: users.workspaceId,
          registrationKey: users.registrationKey,
          kind: users.kind,
        }).from(users).where(eq(users.id, PILOT_USER_ID)).for('update').limit(1),
        transaction.select({
          id: agents.id,
          workspaceId: agents.workspaceId,
          userId: agents.userId,
        }).from(agents).where(eq(agents.id, PILOT_AGENT_ID)).for('update').limit(1),
        transaction.select({
          id: profiles.id,
          workspaceId: profiles.workspaceId,
          userId: profiles.userId,
        }).from(profiles).where(eq(profiles.id, PILOT_PROFILE_ID)).limit(1),
      ]);
      if (!isEqual(user, {
        id: PILOT_USER_ID,
        workspaceId: LUCID_WORKSPACE_ID,
        registrationKey: PILOT_REGISTRATION_KEY,
        kind: 'synthetic',
      }) || !isEqual(agent, {
        id: PILOT_AGENT_ID,
        workspaceId: LUCID_WORKSPACE_ID,
        userId: PILOT_USER_ID,
      }) || !isEqual(profile, {
        id: PILOT_PROFILE_ID,
        workspaceId: LUCID_WORKSPACE_ID,
        userId: PILOT_USER_ID,
      })) {
        throw new Error(
          'Publisher pilot configuration requires the unchanged deterministic Mina Network fixture. Run network:seed first.',
        );
      }

      await transaction.insert(agentJobs).values(PILOT_JOB)
        .onConflictDoNothing();
      await transaction.insert(publishingPreferences).values(PILOT_PREFERENCES)
        .onConflictDoNothing();
      await transaction.insert(publishingTopics).values(PILOT_TOPICS.map(
        (topic, position) => ({
          agentJobId: PUBLISHER_PILOT_ID,
          position,
          topic,
        }),
      )).onConflictDoNothing();
      await transaction.update(users).set({
        status: 'active',
        updatedAt: PILOT_CONFIGURED_AT,
      }).where(and(
        eq(users.id, PILOT_USER_ID),
        eq(users.registrationKey, PILOT_REGISTRATION_KEY),
      ));

      const [
        [configuredJob],
        [configuredPreferences],
        configuredTopics,
        [status],
      ] = await Promise.all([
          transaction.select({
            id: agentJobs.id,
            workspaceId: agentJobs.workspaceId,
            agentId: agentJobs.agentId,
            kind: agentJobs.kind,
            name: agentJobs.name,
            instructions: agentJobs.instructions,
            cadenceMs: agentJobs.cadenceMs,
            enabled: agentJobs.enabled,
            scheduleMode: agentJobs.scheduleMode,
          }).from(agentJobs)
            .where(eq(agentJobs.id, PUBLISHER_PILOT_ID)).limit(1),
          transaction.select({
            agentJobId: publishingPreferences.agentJobId,
            region: publishingPreferences.region,
            intendedAudience: publishingPreferences.intendedAudience,
            tone: publishingPreferences.tone,
            sourceGuidance: publishingPreferences.sourceGuidance,
          }).from(publishingPreferences)
            .where(eq(publishingPreferences.agentJobId, PUBLISHER_PILOT_ID))
            .limit(1),
          transaction.select({
            agentJobId: publishingTopics.agentJobId,
            position: publishingTopics.position,
            topic: publishingTopics.topic,
          }).from(publishingTopics)
            .where(eq(publishingTopics.agentJobId, PUBLISHER_PILOT_ID))
            .orderBy(asc(publishingTopics.position)),
          transaction.select({ status: users.status }).from(users)
            .where(eq(users.id, PILOT_USER_ID)).limit(1),
        ]);
      const expectedTopics = PILOT_TOPICS.map((topic, position) => ({
        agentJobId: PUBLISHER_PILOT_ID,
        position,
        topic,
      }));
      const expectedJob = {
        id: PILOT_JOB.id,
        workspaceId: PILOT_JOB.workspaceId,
        agentId: PILOT_JOB.agentId,
        kind: PILOT_JOB.kind,
        name: PILOT_JOB.name,
        instructions: PILOT_JOB.instructions,
        cadenceMs: PILOT_JOB.cadenceMs,
        enabled: PILOT_JOB.enabled,
        scheduleMode: PILOT_JOB.scheduleMode,
      };
      const expectedPreferences = {
        agentJobId: PILOT_PREFERENCES.agentJobId,
        region: PILOT_PREFERENCES.region,
        intendedAudience: PILOT_PREFERENCES.intendedAudience,
        tone: PILOT_PREFERENCES.tone,
        sourceGuidance: PILOT_PREFERENCES.sourceGuidance,
      };
      if (
        !isEqual(configuredJob, expectedJob)
        || !isEqual(configuredPreferences, expectedPreferences)
        || !isEqual(configuredTopics, expectedTopics)
        || status?.status !== 'active'
      ) {
        throw new Error(
          'Publisher pilot configuration conflicts with the saved Mina job configuration.',
        );
      }

      return {
        pilotId: PUBLISHER_PILOT_ID,
        profileId: PILOT_PROFILE_ID,
        agentJobId: PUBLISHER_PILOT_ID,
        scheduleMode: 'manual',
        cadenceMs: PILOT_JOB.cadenceMs,
      };
    });
  }
}
