import { Router } from "express";
import healthRouter from "./health";
import ordersRouter from "./orders";
import confirmRouter from "./confirm";

const router = Router();

router.use("/health", healthRouter);
router.use("/orders", ordersRouter);
router.use("/orders", confirmRouter);

export default router;
