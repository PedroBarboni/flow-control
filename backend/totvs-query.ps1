param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$Material,
    [Parameter(Mandatory = $true)][string]$Diameter,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$DestinationCode,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$DestinationName,
    [string]$StockWarehouse = "01",
    [string]$ProductionWarehouse = "04",
    [string]$StartDate = "20260901",
    [ValidateRange(1, 100)][int]$Limit = 20
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

function New-TotvsConnection {
    $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.enabled -ne $true) { throw "A consulta ao SQL Server esta desativada." }

    $source = if ($config.port) { "$($config.server),$($config.port)" }
        elseif ($config.instance) { "$($config.server)\$($config.instance)" }
        else { [string]$config.server }

    $builder = [System.Data.SqlClient.SqlConnectionStringBuilder]::new()
    $builder.set_DataSource($source)
    $builder.set_InitialCatalog([string]$config.database)
    $builder.set_ConnectTimeout(10)
    $builder.set_Encrypt([bool]$config.encrypt)
    $builder.set_TrustServerCertificate([bool]$config.trustServerCertificate)
    $builder.set_ApplicationName("Flow Control - Consulta Somente Leitura")
    if ($config.authentication -eq "windows") {
        $builder.set_IntegratedSecurity($true)
    } else {
        $builder.set_UserID([string]$config.user)
        $builder.set_Password([string]$config.password)
    }
    return [System.Data.SqlClient.SqlConnection]::new($builder.ConnectionString)
}

function Add-Parameter($Command, [string]$Name, [System.Data.SqlDbType]$Type, [int]$Size, $Value) {
    [void]$Command.Parameters.Add($Name, $Type, $Size)
    $Command.Parameters[$Name].Value = $Value
}

function Read-Table($Connection, [string]$Sql) {
    $command = $Connection.CreateCommand()
    $command.CommandText = $Sql
    $command.CommandTimeout = 60
    Add-Parameter $command "@material" ([System.Data.SqlDbType]::VarChar) 20 $Material
    Add-Parameter $command "@diameter" ([System.Data.SqlDbType]::VarChar) 20 $Diameter
    Add-Parameter $command "@destinoCodigo" ([System.Data.SqlDbType]::VarChar) 1000 $DestinationCode
    Add-Parameter $command "@destinoNome" ([System.Data.SqlDbType]::VarChar) 80 $DestinationName
    Add-Parameter $command "@armazem" ([System.Data.SqlDbType]::VarChar) 20 $StockWarehouse
    [void]$command.Parameters.Add("@limite", [System.Data.SqlDbType]::Int)
    $command.Parameters["@limite"].Value = $Limit
    $adapter = [System.Data.SqlClient.SqlDataAdapter]::new($command)
    $table = [System.Data.DataTable]::new()
    [void]$adapter.Fill($table)
    return ,$table
}

function Rows-ToObjects($Table) {
    $items = @()
    foreach ($row in $Table.Rows) {
        $item = [ordered]@{}
        foreach ($column in $Table.Columns) {
            $value = $row[$column.ColumnName]
            $item[$column.ColumnName] = if ($value -is [DBNull]) { $null } else { $value }
        }
        $items += [pscustomobject]$item
    }
    return $items
}

$connection = New-TotvsConnection
$connection.Open()
try {
    $productTable = Read-Table $connection @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT DISTINCT TOP (20) RTRIM(B1_COD) AS codigo, RTRIM(B1_DESC) AS descricao, RTRIM(B1_UM) AS unidade
FROM dbo.SB1010 WITH (NOLOCK)
WHERE D_E_L_E_T_ = ''
  AND UPPER(B1_DESC) LIKE '%VERG%RED%'
  AND UPPER(B1_DESC) LIKE '%' + @material + '%'
  AND REPLACE(REPLACE(REPLACE(UPPER(B1_DESC), ',', ''), '.', ''), ' ', '') LIKE '%' + @diameter + '%'
ORDER BY codigo;
"@
    $products = @(Rows-ToObjects $productTable)
    $destinationTable = Read-Table $connection @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT DISTINCT TOP (20) RTRIM(B1_COD) AS codigo, RTRIM(B1_DESC) AS descricao
FROM dbo.SB1010 WITH (NOLOCK)
WHERE D_E_L_E_T_ = ''
  AND ((@destinoCodigo <> '' AND CHARINDEX(',' + RTRIM(B1_COD) + ',', ',' + @destinoCodigo + ',') > 0)
       OR (@destinoCodigo = '' AND @destinoNome <> '' AND
           (UPPER(RTRIM(B1_DESC)) = UPPER(@destinoNome)
            OR UPPER(B1_DESC) LIKE '%' + UPPER(@destinoNome) + '%')))
ORDER BY codigo;
"@
    $destinations = @(Rows-ToObjects $destinationTable)
    $balances = @()
    $movements = @()

    foreach ($product in $products) {
        $balanceCommand = $connection.CreateCommand()
        $balanceCommand.CommandTimeout = 30
        $balanceCommand.CommandText = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT RTRIM(B2_LOCAL) AS armazem, SUM(CONVERT(decimal(28,6), B2_QATU)) AS saldoAtual
FROM dbo.SB2010 WITH (NOLOCK)
WHERE D_E_L_E_T_ = '' AND B2_COD = @produto AND (@armazem = '' OR B2_LOCAL = @armazem)
GROUP BY B2_LOCAL ORDER BY B2_LOCAL;
"@
        Add-Parameter $balanceCommand "@produto" ([System.Data.SqlDbType]::VarChar) 40 $product.codigo
        Add-Parameter $balanceCommand "@armazem" ([System.Data.SqlDbType]::VarChar) 20 $StockWarehouse
        $balanceAdapter = [System.Data.SqlClient.SqlDataAdapter]::new($balanceCommand)
        $balanceTable = [System.Data.DataTable]::new()
        [void]$balanceAdapter.Fill($balanceTable)
        foreach ($balance in (Rows-ToObjects $balanceTable)) {
            $balances += [pscustomobject]@{
                codigo = $product.codigo; descricao = $product.descricao; unidade = $product.unidade
                armazem = $balance.armazem; saldoAtual = $balance.saldoAtual
            }
        }

        $movementCommand = $connection.CreateCommand()
        $movementCommand.CommandTimeout = 45
        $movementCommand.CommandText = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
WITH movimentosIdentificados AS (
    SELECT D3_EMISSAO AS dataMovimento, RTRIM(D3_DOC) AS documento,
           RTRIM(D3_LOCAL) AS armazem, CONVERT(decimal(28,6), D3_QUANT) AS quantidade,
           RTRIM(D3_TM) AS tipoMovimento, RTRIM(D3_CF) AS classificacao,
           RTRIM(D3_NUMSERI) AS destino, RTRIM(D3_LOTECTL) AS loteControle,
           RTRIM(D3_NUMLOTE) AS numeroLote, RTRIM(D3_OP) AS ordemProducao,
           RTRIM(D3_ESTORNO) AS estorno, RTRIM(D3_USUARIO) AS usuario,
           RTRIM(D3_FILIAL) AS filial, RTRIM(D3_ITEM) AS item, R_E_C_N_O_ AS registro,
           CAST(CASE WHEN RTRIM(D3_OBS) <> '' THEN RTRIM(D3_OBS) ELSE RTRIM(D3_OBSERVA) END AS varchar(300)) AS observacao,
           ROW_NUMBER() OVER (
               PARTITION BY RTRIM(D3_NUMSERI)
               ORDER BY D3_EMISSAO, R_E_C_N_O_
           ) AS lotSequence
    FROM dbo.SD3010 WITH (NOLOCK)
    WHERE D_E_L_E_T_ = '' AND D3_COD = @produto
      AND (@armazem = '' OR D3_LOCAL = @armazem)
      AND D3_CF = 'DE4' AND ISNULL(D3_ESTORNO, '') <> 'S'
      AND (@dataInicio = '' OR D3_EMISSAO >= @dataInicio)
      AND ((@destinoCodigo <> '' AND CHARINDEX(',' + RTRIM(D3_NUMSERI) + ',', ',' + @destinoCodigo + ',') > 0)
           OR (@destinoCodigo = '' AND (UPPER(RTRIM(D3_NUMSERI)) = UPPER(@destinoNome)
           OR RTRIM(D3_NUMSERI) IN (
               SELECT RTRIM(B1_COD) FROM dbo.SB1010 WITH (NOLOCK)
               WHERE D_E_L_E_T_ = '' AND (UPPER(RTRIM(B1_DESC)) = UPPER(@destinoNome)
                     OR UPPER(B1_DESC) LIKE '%' + UPPER(@destinoNome) + '%')
           ))))
)
SELECT TOP (@limite) *
FROM movimentosIdentificados
ORDER BY dataMovimento DESC, registro DESC;
"@
        Add-Parameter $movementCommand "@produto" ([System.Data.SqlDbType]::VarChar) 40 $product.codigo
        Add-Parameter $movementCommand "@armazem" ([System.Data.SqlDbType]::VarChar) 20 $ProductionWarehouse
        Add-Parameter $movementCommand "@destinoCodigo" ([System.Data.SqlDbType]::VarChar) 1000 $DestinationCode
        Add-Parameter $movementCommand "@destinoNome" ([System.Data.SqlDbType]::VarChar) 80 $DestinationName
        Add-Parameter $movementCommand "@dataInicio" ([System.Data.SqlDbType]::VarChar) 8 $StartDate
        [void]$movementCommand.Parameters.Add("@limite", [System.Data.SqlDbType]::Int)
        $movementCommand.Parameters["@limite"].Value = $Limit
        $movementAdapter = [System.Data.SqlClient.SqlDataAdapter]::new($movementCommand)
        $movementTable = [System.Data.DataTable]::new()
        [void]$movementAdapter.Fill($movementTable)
        foreach ($movement in (Rows-ToObjects $movementTable)) {
            $movement | Add-Member -NotePropertyName codigo -NotePropertyValue $product.codigo
            $movements += $movement
        }
    }

    [ordered]@{ products = $products; destinations = $destinations; balances = $balances; movements = $movements } |
        ConvertTo-Json -Depth 6 -Compress
} finally {
    $connection.Close()
    $connection.Dispose()
}
