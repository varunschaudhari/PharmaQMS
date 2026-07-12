// PLT-6: the test suite never needs a Redis instance — NotificationsModule.forRoot() composes
// without BullMQ when JOBS_ENABLED=false, and the job processors are thin shells over services
// that the tests exercise directly. Jest setupFiles run before any test-file import, which is
// what makes this effective: AppModule (and its forRoot() call) is evaluated at import time.
process.env.JOBS_ENABLED = 'false';
