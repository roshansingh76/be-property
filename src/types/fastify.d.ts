import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    authUser: { userId: string; phone: string; role: string };
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}
