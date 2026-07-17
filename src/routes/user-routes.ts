import { Router } from "express";
import {
  getAdminsAndStaff,
  getUserByEmail,
  getUsersByRole,
} from "../utils/db-helpers";

const router = Router();

const sanitizeUser = (user: any) => {
  const { passwordHash, PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...safeUser } =
    user;
  return safeUser;
};

router.get("/", async (_req, res, next) => {
  try {
    const users = await getAdminsAndStaff();
    res.json({ data: users.map(sanitizeUser) });
  } catch (error) {
    next(error);
  }
});

router.get("/admins", async (_req, res, next) => {
  try {
    const users = await getUsersByRole("admin");
    res.json({ data: users.map(sanitizeUser) });
  } catch (error) {
    next(error);
  }
});

router.get("/staff", async (_req, res, next) => {
  try {
    const users = await getUsersByRole("staff");
    res.json({ data: users.map(sanitizeUser) });
  } catch (error) {
    next(error);
  }
});

router.get("/by-email/:email", async (req, res, next) => {
  try {
    const user = await getUserByEmail(req.params.email);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ data: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
});

export default router;
