-- CreateTable
CREATE TABLE "appinfo" (
    "id" UUID NOT NULL,
    "appname" TEXT NOT NULL,
    "appkey" TEXT NOT NULL,
    "appcode" TEXT NOT NULL,
    "remark" TEXT,
    "createat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updateat" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appinfo_pkey" PRIMARY KEY ("id")
);
