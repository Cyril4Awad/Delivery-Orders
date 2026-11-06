SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- Orders - every table the Orders backend needs, in the client's SuperStore database
-- (needs the existing tbl_Clients, com_company, COm_Logo).
--
-- One script for a new client and for an upgrade: it creates what is missing and adds missing
-- columns, and never drops a table or deletes data. Safe to run again.
--
--   tbl_OrderStatus      the statuses the screens offer (statuses typed in are added by the app)
--   tbl_Orders           the orders
--   tbl_OrderStatusLog   one row each time an order gets a status
--   tbl_OrderCalls       every call the caller-id phone app reports
-- ============================================================


-- ------------------------------------------------------------
-- tbl_OrderStatus: the statuses offered, in Sts_SortOrder. A status typed in on the screens is
-- added here when an order is saved with it, and is offered from then on.
-- ------------------------------------------------------------
IF OBJECT_ID('dbo.tbl_OrderStatus', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[tbl_OrderStatus](
        [Sts_RecID]      [numeric](18, 0) IDENTITY(1,1) NOT NULL,
        [Sts_Name]       [nvarchar](50)   NOT NULL,
        [Sts_SortOrder]  [int]            NOT NULL,
        [Sts_CDStamp]    [datetime]       NOT NULL CONSTRAINT [DF_tbl_OrderStatus_CDStamp] DEFAULT (getdate()),
        [Sts_CUStamp]    [nvarchar](4)    NULL,
        CONSTRAINT [PK_tbl_OrderStatus] PRIMARY KEY CLUSTERED ([Sts_RecID] ASC)
    ) ON [PRIMARY];

    CREATE UNIQUE NONCLUSTERED INDEX [UX_tbl_OrderStatus_Name] ON [dbo].[tbl_OrderStatus] ([Sts_Name]);
END
GO

-- the four statuses the screens always offer (their colours are fixed on the screens)
MERGE [dbo].[tbl_OrderStatus] AS t
USING (VALUES (N'Under process', 10), (N'Ready', 20), (N'Ready to be delivered', 30), (N'Completed', 40)) AS s ([Name], [SortOrder])
    ON t.[Sts_Name] = s.[Name]
WHEN NOT MATCHED THEN
    INSERT ([Sts_Name], [Sts_SortOrder], [Sts_CDStamp], [Sts_CUStamp]) VALUES (s.[Name], s.[SortOrder], GETDATE(), 'SQL');
GO


-- ------------------------------------------------------------
-- tbl_Orders
--   Ord_Status       one of tbl_OrderStatus (50 max)
--   Ord_Address      where this order goes when it is not the client's address (NULL = the client's)
--   Ord_CompletedAt  when the order was last set to Completed (NULL while it isn't)
-- ------------------------------------------------------------
IF OBJECT_ID('dbo.tbl_Orders', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[tbl_Orders](
        [Ord_RecID]       [numeric](18, 0) IDENTITY(1,1) NOT NULL,
        [Ord_ClientLoc]   [varchar](2)     NULL,
        [Ord_ClientID]    [numeric](18, 0) NULL,
        [Ord_Phone]       [varchar](50)    NULL,
        [Ord_OrderText]   [nvarchar](max)  NOT NULL,
        [Ord_Address]     [nvarchar](500)  NULL,
        [Ord_Status]      [nvarchar](50)   NOT NULL CONSTRAINT [DF_tbl_Orders_Status]  DEFAULT ('Under process'),
        [Ord_CompletedAt] [datetime]       NULL,
        [Ord_CDStamp]     [datetime]       NOT NULL CONSTRAINT [DF_tbl_Orders_CDStamp] DEFAULT (getdate()),
        [Ord_CUStamp]     [nvarchar](4)    NULL,
        [Ord_MDStamp]     [datetime]       NULL,
        [Ord_MUStamp]     [nvarchar](4)    NULL,
        CONSTRAINT [PK_tbl_Orders] PRIMARY KEY CLUSTERED ([Ord_RecID] ASC)
    ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY];

    ALTER TABLE [dbo].[tbl_Orders] WITH CHECK ADD CONSTRAINT [FK_tbl_Orders_Clients] FOREIGN KEY([Ord_ClientLoc], [Ord_ClientID])
    REFERENCES [dbo].[tbl_Clients] ([Clt_Loc], [Clt_RecId]);

    -- the client's latest orders, shown in the order screen when the client calls
    CREATE NONCLUSTERED INDEX [IX_tbl_Orders_Client] ON [dbo].[tbl_Orders] ([Ord_ClientLoc], [Ord_ClientID], [Ord_RecID] DESC);
END
GO

-- columns added after the first installs
IF COL_LENGTH('dbo.tbl_Orders', 'Ord_Address') IS NULL
    ALTER TABLE [dbo].[tbl_Orders] ADD [Ord_Address] [nvarchar](500) NULL;
GO
IF COL_LENGTH('dbo.tbl_Orders', 'Ord_CompletedAt') IS NULL
BEGIN
    ALTER TABLE [dbo].[tbl_Orders] ADD [Ord_CompletedAt] [datetime] NULL;
END
GO
IF COL_LENGTH('dbo.tbl_Orders', 'Ord_Status') IS NULL
    RAISERROR('tbl_Orders is from an older version (no Ord_Status column). Back it up and contact before going on.', 16, 1);
GO

-- orders completed before Ord_CompletedAt existed: their last change
UPDATE [dbo].[tbl_Orders] SET [Ord_CompletedAt] = ISNULL([Ord_MDStamp], [Ord_CDStamp])
WHERE [Ord_Status] = 'Completed' AND [Ord_CompletedAt] IS NULL;
GO

-- statuses already typed in on orders stay on offer, after the four
INSERT INTO [dbo].[tbl_OrderStatus] ([Sts_Name], [Sts_SortOrder], [Sts_CDStamp], [Sts_CUStamp])
SELECT o.[Ord_Status],
       (SELECT ISNULL(MAX([Sts_SortOrder]), 0) FROM [dbo].[tbl_OrderStatus]) + 10 * ROW_NUMBER() OVER (ORDER BY MIN(o.[Ord_RecID])),
       GETDATE(), 'SQL'
FROM [dbo].[tbl_Orders] o
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[tbl_OrderStatus] s WHERE s.[Sts_Name] = o.[Ord_Status])
GROUP BY o.[Ord_Status];
GO


-- ------------------------------------------------------------
-- tbl_OrderStatusLog: one row each time an order gets a status (created, or changed)
-- ------------------------------------------------------------
IF OBJECT_ID('dbo.tbl_OrderStatusLog', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[tbl_OrderStatusLog](
        [Osl_RecID]      [numeric](18, 0) IDENTITY(1,1) NOT NULL,
        [Osl_OrderID]    [numeric](18, 0) NOT NULL,
        [Osl_Status]     [nvarchar](50)   NOT NULL,
        [Osl_Date]       [datetime]       NOT NULL CONSTRAINT [DF_tbl_OrderStatusLog_Date]    DEFAULT (getdate()),
        [Osl_CDStamp]    [datetime]       NOT NULL CONSTRAINT [DF_tbl_OrderStatusLog_CDStamp] DEFAULT (getdate()),
        [Osl_CUStamp]    [nvarchar](4)    NULL,
        CONSTRAINT [PK_tbl_OrderStatusLog] PRIMARY KEY CLUSTERED ([Osl_RecID] ASC)
    ) ON [PRIMARY];

    CREATE NONCLUSTERED INDEX [IX_tbl_OrderStatusLog_Order] ON [dbo].[tbl_OrderStatusLog] ([Osl_OrderID], [Osl_RecID]);
END
GO
IF OBJECT_ID('dbo.FK_tbl_OrderStatusLog_Orders', 'F') IS NULL
    ALTER TABLE [dbo].[tbl_OrderStatusLog] WITH CHECK ADD CONSTRAINT [FK_tbl_OrderStatusLog_Orders] FOREIGN KEY([Osl_OrderID])
    REFERENCES [dbo].[tbl_Orders] ([Ord_RecID]);
GO

-- orders from before the log: their current status, as of their last change
INSERT INTO [dbo].[tbl_OrderStatusLog] ([Osl_OrderID], [Osl_Status], [Osl_Date], [Osl_CDStamp], [Osl_CUStamp])
SELECT o.[Ord_RecID], o.[Ord_Status], ISNULL(o.[Ord_MDStamp], o.[Ord_CDStamp]), GETDATE(), 'SQL'
FROM [dbo].[tbl_Orders] o
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[tbl_OrderStatusLog] l WHERE l.[Osl_OrderID] = o.[Ord_RecID]);
GO


-- ------------------------------------------------------------
-- tbl_OrderCalls: every call the caller-id phone app reports
--   Cal_Status   Ringing | Answered | Missed | Handled | Ordered
--                (the backend stores Missed once a call rings out - IncomingCall:RingSeconds)
--   Cal_OrderID  the order taken for this call
-- ------------------------------------------------------------
IF OBJECT_ID('dbo.tbl_OrderCalls', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[tbl_OrderCalls](
        [Cal_RecID]       [numeric](18, 0) IDENTITY(1,1) NOT NULL,
        [Cal_Loc]         [varchar](2)     NOT NULL,
        [Cal_Phone]       [varchar](50)    NOT NULL,
        [Cal_Match]       [varchar](10)    NOT NULL,
        [Cal_MatchCount]  [int]            NOT NULL CONSTRAINT [DF_tbl_OrderCalls_MatchCount] DEFAULT ((0)),
        [Cal_ClientLoc]   [varchar](2)     NULL,
        [Cal_ClientID]    [numeric](18, 0) NULL,
        [Cal_Status]      [varchar](10)    NOT NULL CONSTRAINT [DF_tbl_OrderCalls_Status]     DEFAULT ('Ringing'),
        [Cal_TakenBy]     [varchar](100)   NULL,
        [Cal_TakenAt]     [datetime]       NULL,
        [Cal_OrderID]     [numeric](18, 0) NULL,
        [Cal_CDStamp]     [datetime]       NOT NULL CONSTRAINT [DF_tbl_OrderCalls_CDStamp]    DEFAULT (getdate()),
        [Cal_MDStamp]     [datetime]       NULL,
        [Cal_MUStamp]     [nvarchar](4)    NULL,
        CONSTRAINT [PK_tbl_OrderCalls] PRIMARY KEY CLUSTERED ([Cal_RecID] ASC)
    ) ON [PRIMARY];

    CREATE NONCLUSTERED INDEX [IX_tbl_OrderCalls_Loc_CDStamp] ON [dbo].[tbl_OrderCalls] ([Cal_Loc], [Cal_CDStamp] DESC);
END
GO
IF OBJECT_ID('dbo.FK_tbl_OrderCalls_Orders', 'F') IS NULL
    ALTER TABLE [dbo].[tbl_OrderCalls] WITH CHECK ADD CONSTRAINT [FK_tbl_OrderCalls_Orders] FOREIGN KEY([Cal_OrderID])
    REFERENCES [dbo].[tbl_Orders] ([Ord_RecID]);
GO

-- calls with an order read Ordered
UPDATE [dbo].[tbl_OrderCalls] SET [Cal_Status] = 'Ordered'
WHERE [Cal_OrderID] IS NOT NULL AND [Cal_Status] <> 'Ordered';
GO

PRINT 'Orders tables are ready.';
GO
