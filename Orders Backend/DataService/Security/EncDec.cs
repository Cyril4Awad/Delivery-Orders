using System.Security.Cryptography;
using System.Text;

namespace DataService.Security
{
    /// <summary>
    /// Decrypts connection strings encrypted with the tool (same algorithm, pass phrase and IV as
    /// Sales Volume Rebate's DataService/Security/EncDec.cs - keep them in step, or existing encrypted
    /// strings stop working).
    /// </summary>
    public static class EncDec
    {
        private const string InitVector = "REDACTED";
        private const int KeySize = 256;

        static EncDec()
        {
            // windows-1252 / windows-1256 used by DecPS
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        }

        /// <summary>The plain connection string; throws when the text can't be decrypted.</summary>
        public static string DecryptConnectionString(string cipherText)
        {
            return DecryptString(cipherText, DecPS("ju" + (char)128 + "zz{j"));
        }

        /// <summary>Reverses and shifts the stored pass phrase (scheme).</summary>
        public static string DecPS(string spwd1)
        {
            var result = new StringBuilder();
            int lp = spwd1.Length;
            for (int i = 1; i <= lp; i++)
            {
                char rightChar = spwd1[spwd1.Length - i];
                char decodedChar = (char)(rightChar - lp);
                byte[] bytes = Encoding.GetEncoding("windows-1252").GetBytes(decodedChar.ToString());
                result.Append(Encoding.GetEncoding("windows-1256").GetString(bytes));
            }
            return result.ToString();
        }

        public static string DecryptString(string cipherText, string passPhrase)
        {
            byte[] initVectorBytes = Encoding.UTF8.GetBytes(InitVector);
            byte[] cipherTextBytes = Convert.FromBase64String(cipherText.Trim());

            // PasswordDeriveBytes is obsolete, but it is what the encrypting side uses to derive the key
#pragma warning disable SYSLIB0041
            using var password = REDACTED PasswordDeriveBytes(passPhrase, null);
            byte[] keyBytes = password.GetBytes(KeySize / 8);
#pragma warning restore SYSLIB0041

            using var aes = Aes.Create();
            aes.Mode = CipherMode.CBC;
            aes.Padding = PaddingMode.PKCS7;
            using var decryptor = aes.CreateDecryptor(keyBytes, initVectorBytes);
            using var memoryStream = new MemoryStream(cipherTextBytes);
            using var cryptoStream = new CryptoStream(memoryStream, decryptor, CryptoStreamMode.Read);
            using var reader = new StreamReader(cryptoStream, Encoding.UTF8);
            return reader.ReadToEnd();
        }
    }
}
