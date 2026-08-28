CREATE TABLE "point_catalog_items" (
	"point_catalog_item_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"item_type" varchar(32) NOT NULL,
	"surface" varchar(32) NOT NULL,
	"equip_slot" varchar(32) NOT NULL,
	"theme_family" varchar(32) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(280) NOT NULL,
	"price" integer NOT NULL,
	"permanent" boolean DEFAULT true NOT NULL,
	"sale_start_at" timestamp with time zone,
	"sale_end_at" timestamp with time zone,
	"usage_end_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_catalog_items_code_unique" UNIQUE("code"),
	CONSTRAINT "point_catalog_items_price_check" CHECK ("point_catalog_items"."price" > 0),
	CONSTRAINT "point_catalog_items_version_check" CHECK ("point_catalog_items"."current_version" > 0),
	CONSTRAINT "point_catalog_items_status_check" CHECK ("point_catalog_items"."status" in ('ACTIVE', 'PAUSED', 'RETIRED')),
	CONSTRAINT "point_catalog_items_sale_period_check" CHECK ("point_catalog_items"."sale_end_at" is null or "point_catalog_items"."sale_start_at" is null or "point_catalog_items"."sale_end_at" > "point_catalog_items"."sale_start_at")
);
--> statement-breakpoint
CREATE TABLE "point_catalog_item_versions" (
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"asset_manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview_assets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accessibility_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"release_notes" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_catalog_item_versions_pk" PRIMARY KEY("item_id","version"),
	CONSTRAINT "point_catalog_item_versions_version_check" CHECK ("point_catalog_item_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "point_purchases" (
	"point_purchase_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_version" integer NOT NULL,
	"price_snapshot" integer NOT NULL,
	"spend_ledger_entry_id" uuid NOT NULL,
	"refund_ledger_entry_id" uuid,
	"idempotency_key" varchar(160) NOT NULL,
	"status" varchar(16) DEFAULT 'COMPLETED' NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refunded_at" timestamp with time zone,
	CONSTRAINT "point_purchases_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "point_purchases_spend_ledger_unique" UNIQUE("spend_ledger_entry_id"),
	CONSTRAINT "point_purchases_price_check" CHECK ("point_purchases"."price_snapshot" > 0),
	CONSTRAINT "point_purchases_version_check" CHECK ("point_purchases"."item_version" > 0),
	CONSTRAINT "point_purchases_status_check" CHECK ("point_purchases"."status" in ('COMPLETED', 'REFUNDED'))
);
--> statement-breakpoint
CREATE TABLE "member_inventory" (
	"member_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"acquired_from" varchar(24) DEFAULT 'PURCHASE' NOT NULL,
	"state" varchar(16) DEFAULT 'OWNED' NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "member_inventory_pk" PRIMARY KEY("member_id","item_id"),
	CONSTRAINT "member_inventory_purchase_unique" UNIQUE("purchase_id"),
	CONSTRAINT "member_inventory_state_check" CHECK ("member_inventory"."state" in ('OWNED', 'EXPIRED', 'REVOKED')),
	CONSTRAINT "member_inventory_acquired_from_check" CHECK ("member_inventory"."acquired_from" in ('PURCHASE', 'GRANT', 'MIGRATION'))
);
--> statement-breakpoint
CREATE TABLE "member_equipment" (
	"member_id" uuid NOT NULL,
	"equip_slot" varchar(32) NOT NULL,
	"item_id" uuid NOT NULL,
	"equipped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_equipment_pk" PRIMARY KEY("member_id","equip_slot")
);
--> statement-breakpoint
ALTER TABLE "point_catalog_item_versions" ADD CONSTRAINT "point_catalog_item_versions_item_id_point_catalog_items_point_catalog_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."point_catalog_items"("point_catalog_item_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "point_purchases" ADD CONSTRAINT "point_purchases_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "point_purchases" ADD CONSTRAINT "point_purchases_item_id_point_catalog_items_point_catalog_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."point_catalog_items"("point_catalog_item_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "point_purchases" ADD CONSTRAINT "point_purchases_spend_ledger_entry_id_point_ledger_entries_point_ledger_entry_id_fk" FOREIGN KEY ("spend_ledger_entry_id") REFERENCES "public"."point_ledger_entries"("point_ledger_entry_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "point_purchases" ADD CONSTRAINT "point_purchases_refund_ledger_entry_id_point_ledger_entries_point_ledger_entry_id_fk" FOREIGN KEY ("refund_ledger_entry_id") REFERENCES "public"."point_ledger_entries"("point_ledger_entry_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_inventory" ADD CONSTRAINT "member_inventory_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_inventory" ADD CONSTRAINT "member_inventory_item_id_point_catalog_items_point_catalog_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."point_catalog_items"("point_catalog_item_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_inventory" ADD CONSTRAINT "member_inventory_purchase_id_point_purchases_point_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."point_purchases"("point_purchase_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_equipment" ADD CONSTRAINT "member_equipment_inventory_fk" FOREIGN KEY ("member_id","item_id") REFERENCES "public"."member_inventory"("member_id","item_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "point_catalog_items_listing_idx" ON "point_catalog_items" USING btree ("status","surface","theme_family");
--> statement-breakpoint
CREATE UNIQUE INDEX "point_purchases_refund_ledger_unique" ON "point_purchases" USING btree ("refund_ledger_entry_id") WHERE "point_purchases"."refund_ledger_entry_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "point_purchases_member_item_active_unique" ON "point_purchases" USING btree ("member_id","item_id") WHERE "point_purchases"."status" = 'COMPLETED';
--> statement-breakpoint
CREATE INDEX "point_purchases_member_created_idx" ON "point_purchases" USING btree ("member_id","purchased_at");
--> statement-breakpoint
CREATE INDEX "member_inventory_member_state_idx" ON "member_inventory" USING btree ("member_id","state");
--> statement-breakpoint
CREATE INDEX "member_equipment_item_idx" ON "member_equipment" USING btree ("item_id");
--> statement-breakpoint
WITH seed(code, item_type, surface, equip_slot, theme_family, name, description, price) AS (
	VALUES
	('SIGNAL_GRID_ACCENT', 'COSMETIC', 'PROFILE', 'PROFILE_ACCENT', 'SIGNAL_GRID', 'Signal Grid Accent', '신호 격자에서 영감을 얻은 프로필 강조색입니다.', 600),
	('SIGNAL_GRID_AVATAR_FRAME', 'COSMETIC', 'PROFILE', 'AVATAR_FRAME', 'SIGNAL_GRID', 'Signal Grid Frame', '신호 격자 테두리로 프로필 이미지를 꾸밉니다.', 1400),
	('SIGNAL_GRID_SHARE_CARD', 'COSMETIC', 'SHARE_CARD', 'SHARE_BACKGROUND', 'SIGNAL_GRID', 'Signal Grid Share', '공유 카드에 신호 격자 배경을 적용합니다.', 1100),
	('PAPER_VOTE_ACCENT', 'COSMETIC', 'PROFILE', 'PROFILE_ACCENT', 'PAPER_VOTE', 'Paper Vote Accent', '투표 용지 느낌의 차분한 프로필 강조색입니다.', 500),
	('PAPER_VOTE_AVATAR_FRAME', 'COSMETIC', 'PROFILE', 'AVATAR_FRAME', 'PAPER_VOTE', 'Paper Vote Frame', '종이 질감의 프로필 이미지 테두리입니다.', 1200),
	('PAPER_VOTE_SHARE_CARD', 'COSMETIC', 'SHARE_CARD', 'SHARE_BACKGROUND', 'PAPER_VOTE', 'Paper Vote Share', '투표 용지 스타일의 공유 카드 배경입니다.', 1000),
	('NEON_RIFT_ACCENT', 'COSMETIC', 'PROFILE', 'PROFILE_ACCENT', 'NEON_RIFT', 'Neon Rift Accent', '선명한 네온 대비의 프로필 강조색입니다.', 700),
	('NEON_RIFT_AVATAR_FRAME', 'COSMETIC', 'PROFILE', 'AVATAR_FRAME', 'NEON_RIFT', 'Neon Rift Frame', '네온 균열 효과의 프로필 이미지 테두리입니다.', 1600),
	('NEON_RIFT_SHARE_CARD', 'COSMETIC', 'SHARE_CARD', 'SHARE_BACKGROUND', 'NEON_RIFT', 'Neon Rift Share', '네온 균열 스타일의 공유 카드 배경입니다.', 1400),
	('SOFT_ORBIT_ACCENT', 'COSMETIC', 'PROFILE', 'PROFILE_ACCENT', 'SOFT_ORBIT', 'Soft Orbit Accent', '부드러운 궤도 색상의 프로필 강조색입니다.', 500),
	('SOFT_ORBIT_AVATAR_FRAME', 'COSMETIC', 'PROFILE', 'AVATAR_FRAME', 'SOFT_ORBIT', 'Soft Orbit Frame', '둥근 궤도 형태의 프로필 이미지 테두리입니다.', 1200),
	('SOFT_ORBIT_SHARE_CARD', 'COSMETIC', 'SHARE_CARD', 'SHARE_BACKGROUND', 'SOFT_ORBIT', 'Soft Orbit Share', '부드러운 궤도 스타일의 공유 카드 배경입니다.', 900)
)
INSERT INTO "point_catalog_items" ("code", "item_type", "surface", "equip_slot", "theme_family", "name", "description", "price")
SELECT * FROM seed
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "point_catalog_item_versions" ("item_id", "version", "asset_manifest", "preview_assets", "accessibility_metadata", "release_notes")
SELECT
	i."point_catalog_item_id",
	1,
	jsonb_build_object(
		'schemaVersion', 1,
		'renderType', 'TOKEN_THEME',
		'themeFamily', i."theme_family",
		'equipSlot', i."equip_slot",
		'choiceA', '#15C4D6',
		'choiceB', '#FF7A1A'
	),
	jsonb_build_object('kind', 'CSS_TOKEN_PREVIEW', 'themeFamily', i."theme_family"),
	jsonb_build_object('decorativeOnly', true, 'requiresTextContrast', true, 'reducedMotionSafe', true),
	'WHICH-117 initial catalog v1'
FROM "point_catalog_items" i
WHERE i."code" IN (
	'SIGNAL_GRID_ACCENT', 'SIGNAL_GRID_AVATAR_FRAME', 'SIGNAL_GRID_SHARE_CARD',
	'PAPER_VOTE_ACCENT', 'PAPER_VOTE_AVATAR_FRAME', 'PAPER_VOTE_SHARE_CARD',
	'NEON_RIFT_ACCENT', 'NEON_RIFT_AVATAR_FRAME', 'NEON_RIFT_SHARE_CARD',
	'SOFT_ORBIT_ACCENT', 'SOFT_ORBIT_AVATAR_FRAME', 'SOFT_ORBIT_SHARE_CARD'
)
ON CONFLICT ("item_id", "version") DO NOTHING;
