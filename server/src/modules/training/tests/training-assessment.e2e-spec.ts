import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ALL_PERMISSION_KEYS, PermissionAction, PermissionModule } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { Role, RoleDocument } from '../../../platform/auth/schemas/role.schema';
import { User, UserDocument } from '../../../platform/auth/schemas/user.schema';
import { TrainingAssignment, TrainingAssignmentDocument } from '../schemas/training-assignment.schema';

const PASSWORD = 'Correct1!';

// TRN-6: the assessment HTTP surface, exercised directly against a seeded TrainingAssignment
// (the assessment/attempt endpoints operate on documentId/versionId as opaque strings, same as
// TrainingAssignment itself — they don't require the full DOC-3/DOC-9 approval chain that
// training.e2e-spec.ts already covers for TRN-1..TRN-5).
describe('TRN-6 Assessments HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let qaToken: string;
  let operatorToken: string;
  let assignmentId: string;

  const server = () => app.getHttpServer();

  async function login(email: string): Promise<string> {
    const response = await request(server()).post('/api/v1/auth/login').send({ tenantId, email, password: PASSWORD });
    return response.body.data.tokens.accessToken as string;
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const roleModel = moduleFixture.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    const assignmentModel = moduleFixture.get<Model<TrainingAssignmentDocument>>(getModelToken(TrainingAssignment.name));

    tenantId = new mongoose.Types.ObjectId().toString();
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const qaRole = await roleModel.create({
      tenantId,
      name: 'QA Head',
      permissions: [
        `${PermissionModule.TRAINING}:${PermissionAction.VIEW}`,
        `${PermissionModule.TRAINING}:${PermissionAction.EDIT}`,
        `${PermissionModule.TRAINING}:${PermissionAction.APPROVE}`,
      ],
    });
    await userModel.create({ tenantId, email: 'qa@example.com', fullName: 'Quinn Qahead', passwordHash, roleId: qaRole._id });
    const operatorRole = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });
    const operator = await userModel.create({ tenantId, email: 'operator@example.com', fullName: 'Olive Operator', passwordHash, roleId: operatorRole._id });

    const assignment = await assignmentModel.create({
      tenantId,
      userId: operator._id.toString(),
      documentId: 'doc-1',
      docNumber: 'SOP-QA-001',
      documentTitle: 'Cleaning of pH meters',
      versionId: 'ver-1',
      versionLabel: '1.0',
      status: 'pending',
      assignedAt: new Date(),
    });
    assignmentId = assignment._id.toString();

    qaToken = await login('qa@example.com');
    operatorToken = await login('operator@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('TRN-6: an operator without training:edit cannot author an assessment', async () => {
    const response = await request(server())
      .put('/api/v1/training/documents/doc-1/versions/ver-1/assessment')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ docNumber: 'SOP-QA-001', versionLabel: '1.0', questions: [{ questionText: 'Q1?', options: ['A', 'B'], correctOptionIndex: 0 }] });
    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('TRN-6: QA authors then approves an assessment', async () => {
    const upserted = await request(server())
      .put('/api/v1/training/documents/doc-1/versions/ver-1/assessment')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        docNumber: 'SOP-QA-001',
        versionLabel: '1.0',
        questions: [
          { questionText: 'What is the required cleaning frequency?', options: ['Daily', 'Weekly'], correctOptionIndex: 0 },
        ],
      });
    expect(upserted.status).toBe(HttpStatus.OK);
    expect(upserted.body.data.status).toBe('draft');

    const approved = await request(server())
      .post('/api/v1/training/documents/doc-1/versions/ver-1/assessment/approve')
      .set('Authorization', `Bearer ${qaToken}`);
    expect(approved.status).toBe(HttpStatus.CREATED);
    expect(approved.body.data.status).toBe('approved');
  });

  it('TRN-6: the trainee fetches their quiz (no answer key) and submits a passing attempt', async () => {
    const quiz = await request(server()).get(`/api/v1/training/assignments/${assignmentId}/assessment`).set('Authorization', `Bearer ${operatorToken}`);
    expect(quiz.status).toBe(HttpStatus.OK);
    expect(quiz.body.data.questions).toHaveLength(1);
    const question = quiz.body.data.questions[0];
    expect(question.correctOptionIndex).toBeUndefined();

    const attempt = await request(server())
      .post(`/api/v1/training/assignments/${assignmentId}/assessment/attempts`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ answers: [{ questionId: question.id, selectedOptionIndex: 0 }] });
    expect(attempt.status).toBe(HttpStatus.CREATED);
    expect(attempt.body.data.attempt.passed).toBe(true);
    expect(attempt.body.data.attempt.scorePercentage).toBe(100);
  });

  it('TRN-6: another user cannot fetch or attempt someone else\'s assignment quiz', async () => {
    const getAttempt = await request(server()).get(`/api/v1/training/assignments/${assignmentId}/assessment`).set('Authorization', `Bearer ${qaToken}`);
    expect(getAttempt.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('PLT-8 tenant isolation: another tenant cannot reach this assignment or assessment', async () => {
    const otherTenant = new mongoose.Types.ObjectId().toString();
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const outsiderRole = await roleModel.create({ tenantId: otherTenant, name: 'Outsider', permissions: ALL_PERMISSION_KEYS });
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await userModel.create({ tenantId: otherTenant, email: 'outsider@else.example', fullName: 'Outsider', passwordHash, roleId: outsiderRole._id });
    const outsiderLogin = await request(server()).post('/api/v1/auth/login').send({ tenantId: otherTenant, email: 'outsider@else.example', password: PASSWORD });
    const outsiderToken = outsiderLogin.body.data.tokens.accessToken as string;

    const getAttempt = await request(server()).get(`/api/v1/training/assignments/${assignmentId}/assessment`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(getAttempt.status).toBe(HttpStatus.NOT_FOUND);

    const authoring = await request(server()).get('/api/v1/training/documents/doc-1/versions/ver-1/assessment').set('Authorization', `Bearer ${outsiderToken}`);
    expect(authoring.body.data).toBeNull();
  });
});
