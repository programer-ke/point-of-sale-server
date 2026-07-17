import { Router } from "express";
import userRoutes from "./user-routes";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    name: "pos-server",
    endpoints: {
      health: "/health",
      graphql: "/graphql",
      users: "/api/users",
      admins: "/api/users/admins",
      staff: "/api/users/staff",
    },
  });
});

router.use("/users", userRoutes);

export default router;
