// Shared setup for all test types.
// Unit tests run without database; integration tests configure DB via env.
process.env.NODE_ENV = process.env.NODE_ENV || "test"
